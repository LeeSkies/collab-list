begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- Fixture: the seeded household owns admin (…0001) and member (…0002). The
-- member exercises creation; deletion stays admin-only.
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select lives_ok(
  $$ select public.create_category('  baking basics  ') $$,
  'a regular member can create a category'
);
select is(
  (select name from public.categories
   where household_id = (select household_id from public.household_members where user_id = auth.uid())
     and name = 'baking basics'),
  'baking basics',
  'create_category trims surrounding whitespace'
);
select is(
  (select count(*) from public.categories
   where household_id = (select household_id from public.household_members where user_id = auth.uid())),
  11::bigint,
  'member-created category is stored'
);
select throws_ok(
  $$ select public.create_category('baking basics') $$,
  '23505',
  null,
  'duplicate category names are rejected'
);
select throws_ok(
  $$ select public.create_category('   ') $$,
  '22023',
  'invalid_category_name',
  'blank category names are rejected'
);
select throws_ok(
  $$ select public.create_category(repeat('x', 81)) $$,
  '22023',
  'invalid_category_name',
  'names longer than 80 characters are rejected'
);
select throws_ok(
  $$ select public.delete_category(
    (select id from public.categories where name = 'baking basics')
  ) $$,
  '42501',
  'admin_required',
  'a regular member cannot delete a category'
);
-- Quick-create regression: the default category still resolves to other.
select lives_ok(
  $$ select public.create_product('Category test bread') $$,
  'quick create still works after a member category mutation'
);
select is(
  (select category.name
   from public.products as product
   join public.categories as category on category.id = product.category_id
   where product.name = 'Category test bread'),
  'other',
  'quick-created products still default to the other category'
);

-- Admin delete: products in the deleted category are atomically reassigned.
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select public.create_category('temporary treats') $$,
  'an admin can create a category'
);
select lives_ok(
  $$ select public.create_product('Category test cookie') $$,
  'an admin can create a product'
);
select lives_ok(
  $$ select public.update_product(
    (select id from public.products where name = 'Category test cookie'),
    'Category test cookie',
    '1',
    '',
    (select id from public.categories
     where household_id = (select household_id from public.household_members where user_id = auth.uid())
       and name = 'temporary treats'),
    (select version from public.products where name = 'Category test cookie')
  ) $$,
  'a product can be moved into the deletable category'
);
select is(
  (select category.name
   from public.products as product
   join public.categories as category on category.id = product.category_id
   where product.name = 'Category test cookie'),
  'temporary treats',
  'the product sits in the category about to be deleted'
);
select lives_ok(
  $$ select public.delete_category(
    (select id from public.categories
     where household_id = (select household_id from public.household_members where user_id = auth.uid())
       and name = 'temporary treats')
  ) $$,
  'an admin can delete a category'
);
select is(
  (select count(*) from public.categories where name = 'temporary treats'),
  0::bigint,
  'the deleted category row is gone'
);
select is(
  (select category.name
   from public.products as product
   join public.categories as category on category.id = product.category_id
   where product.name = 'Category test cookie'),
  'other',
  'deleting a category reassigns its products to other'
);
select throws_ok(
  $$ select public.delete_category(
    (select id from public.categories
     where household_id = (select household_id from public.household_members where user_id = auth.uid())
       and name = 'other')
  ) $$,
  'P0001',
  'cannot_delete_other',
  'the other category itself cannot be deleted'
);
select throws_ok(
  $$ select public.delete_category('00000000-0000-0000-0000-000000000000'::uuid) $$,
  'P0002',
  'category_not_found',
  'unknown category ids are reported missing'
);

-- Cross-household fixture: a second household whose category id is captured
-- before switching roles, because category RLS hides it from other members.
set local role postgres;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  instance_id, '10000000-0000-0000-0000-000000000003'::uuid, aud, role,
  'other@example.com', encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change_token, reauthentication_token,
  raw_app_meta_data, '{"name":"Other Household"}'::jsonb, now(), now()
from auth.users
where id = '10000000-0000-0000-0000-000000000001'::uuid;
with inserted_household as (
  insert into public.households(name) values ('Other household') returning id
)
insert into public.household_members(household_id, user_id, role)
select id, '10000000-0000-0000-0000-000000000003'::uuid, 'member'
from inserted_household;
insert into public.categories(household_id, name)
select household.id, seed.name
from public.households as household
cross join (
  values
    ('fruit_vegetables'),
    ('dairy_eggs'),
    ('meat_fish'),
    ('bakery'),
    ('pantry'),
    ('frozen'),
    ('drinks'),
    ('snacks'),
    ('household'),
    ('other')
) as seed(name)
where household.name = 'Other household'
on conflict do nothing;
create temp table other_household_category as
select category.id
from public.categories as category
join public.household_members as membership
  on membership.household_id = category.household_id
where membership.user_id = '10000000-0000-0000-0000-000000000003'::uuid
  and category.name = 'other';
grant select on other_household_category to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select is(
  (select count(*) from public.categories),
  10::bigint,
  'a member reads only their own household categories'
);

-- An admin of the first household cannot see or delete the other household's
-- category: the lookup is household-scoped and reports it missing.
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select public.delete_category((select id from other_household_category)) $$,
  'P0002',
  'category_not_found',
  'a category from another household is reported missing'
);

-- Select-only table grants: direct writes stay blocked for authenticated.
select throws_ok(
  $$ insert into public.categories(household_id, name)
     values ('00000000-0000-0000-0000-000000000000'::uuid, 'sneaky') $$,
  '42501',
  'permission denied for table categories',
  'direct category inserts are denied'
);
select throws_ok(
  $$ update public.categories set name = 'renamed' where name = 'other' $$,
  '42501',
  'permission denied for table categories',
  'direct category updates are denied'
);
select throws_ok(
  $$ delete from public.categories where name = 'other' $$,
  '42501',
  'permission denied for table categories',
  'direct category deletes are denied'
);
set local role anon;
select throws_ok(
  $$ select * from public.categories $$,
  '42501',
  'permission denied for table categories',
  'anonymous users cannot read categories'
);

-- Entitlement boundary: category writes follow the household read-only state.
set local role postgres;
update public.feature_flags
set enabled = true
where key = 'household_entitlement_enforcement';
update public.household_trials
set starts_at = now() - interval '17 days',
    ends_at = now() - interval '3 days'
where household_id = (
  select household_id
  from public.household_members
  where user_id = '10000000-0000-0000-0000-000000000001'::uuid
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select public.create_category('blocked category') $$,
  '42501',
  'household_read_only',
  'category creation is blocked for a read-only household'
);
select throws_ok(
  $$ select public.delete_category(
    (select id from public.categories
     where household_id = (select household_id from public.household_members where user_id = auth.uid())
       and name = 'bakery')
  ) $$,
  '42501',
  'household_read_only',
  'category deletion is blocked for a read-only household'
);

-- Grants surface: execute for authenticated on the RPCs, select-only table.
select is(
  has_table_privilege('authenticated', 'public.categories', 'SELECT'),
  true,
  'authenticated can select categories'
);
select is(
  has_table_privilege('authenticated', 'public.categories', 'INSERT'),
  false,
  'authenticated cannot insert categories directly'
);
select is(
  has_table_privilege('authenticated', 'public.categories', 'UPDATE'),
  false,
  'authenticated cannot update categories directly'
);
select is(
  has_table_privilege('authenticated', 'public.categories', 'DELETE'),
  false,
  'authenticated cannot delete categories directly'
);
select is(
  has_function_privilege('authenticated', 'public.create_category(text)', 'EXECUTE'),
  true,
  'authenticated can execute create_category'
);
select is(
  has_function_privilege('authenticated', 'public.delete_category(uuid)', 'EXECUTE'),
  true,
  'authenticated can execute delete_category'
);
select is(
  has_function_privilege('anon', 'public.create_category(text)', 'EXECUTE'),
  false,
  'anon cannot execute create_category'
);
select is(
  has_function_privilege('anon', 'public.delete_category(uuid)', 'EXECUTE'),
  false,
  'anon cannot execute delete_category'
);
select is(
  (select count(*) from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'categories'),
  1::bigint,
  'categories are published for realtime'
);
select is(
  (select relreplident::text from pg_class where oid = 'public.categories'::regclass),
  'f',
  'categories use full replica identity for filtered realtime deletes'
);
