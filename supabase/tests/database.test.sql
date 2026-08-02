begin;
create extension if not exists pgtap with schema extensions;
select plan(73);

select has_table('public', 'products', 'products exists');
select has_table('public', 'households', 'households exist');
select has_table('public', 'household_members', 'household memberships exist');
select has_column('public', 'products', 'household_id', 'products carry the household boundary');
select is(
  (select relreplident::text from pg_class where oid = 'public.products'::regclass),
  'f',
  'products use full replica identity for filtered realtime deletes'
);
select hasnt_table('public', 'product_pick_history', 'history table was removed');
select has_table('public', 'profiles', 'profiles exists');
select has_column('public', 'profiles', 'name', 'profiles have display names');
select col_not_null('public', 'profiles', 'name', 'profile names are required');
select is((select name from public.profiles where email = 'admin@example.com'), 'Local Admin', 'new-user trigger stores the supplied display name');
select throws_ok($$ update public.profiles set name = '' where email = 'admin@example.com' $$, '23514', null, 'blank profile names are rejected');
select col_type_is('public', 'products', 'quantity', 'numeric(5,2)', 'quantity is exact numeric');
select col_is_pk('public', 'products', 'id', 'product id is primary key');
select fk_ok('public', 'products', 'updated_by', 'public', 'profiles', 'id', 'product updater references profiles');
select has_column('public', 'products', 'category', 'products have categories');
select col_not_null('public', 'products', 'category', 'product categories are required');
select is(
  (select count(*) from public.products where category <> 'other'),
  0::bigint,
  'existing products default to other'
);
select is(public.product_name_signature('soy milk'), public.product_name_signature('Milk-Soy'), 'unordered case-insensitive tokens collide');
select isnt(public.product_name_signature('milk milk'), public.product_name_signature('milk'), 'token counts remain distinct');
select is(public.normalize_product_name('  חלב   סויה '), 'חלב סויה', 'Hebrew whitespace normalizes');

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select lives_ok($$ select public.create_product('Test apples') $$, 'authenticated user can create through RPC');
select throws_ok($$ select public.create_product('APPLES test') $$, '23505', null, 'database prevents duplicate word signature');
select is((select quantity::text from public.products where name = 'Test apples'), '1.00', 'default quantity is one');
select is((select category from public.products where name = 'Test apples'), 'other', 'quick-created products default to other');
select lives_ok(
  $$
  do $categories$
  declare category_key text;
  begin
    foreach category_key in array array[
      'fruit_vegetables', 'dairy_eggs', 'meat_fish', 'bakery', 'pantry',
      'frozen', 'drinks', 'snacks', 'household', 'other'
    ] loop
      perform public.update_product(
        (select id from public.products where name = 'Test apples'),
        'Test apples',
        '1',
        '',
        category_key,
        (select version from public.products where name = 'Test apples')
      );
    end loop;
  end
  $categories$
  $$,
  'all supported category keys can be saved'
);
select throws_ok(
  $$ select public.update_product(
    (select id from public.products where name = 'Test apples'),
    'Test apples',
    '1',
    '',
    'invalid',
    (select version from public.products where name = 'Test apples')
  ) $$,
  '23514',
  null,
  'invalid category keys are rejected'
);
select lives_ok($$ select public.adjust_product_quantity((select id from public.products where name='Test apples'), 1, (select version from public.products where name='Test apples')) $$, 'atomic increment succeeds');
select is((select quantity::text from public.products where name = 'Test apples'), '2.00', 'atomic increment changes by one');
select lives_ok($$ select public.toggle_product_picked((select id from public.products where name='Test apples'), (select version from public.products where name='Test apples'), false) $$, 'conditional pick succeeds');
select is((select updated_by from public.products where name='Test apples'), '10000000-0000-0000-0000-000000000001'::uuid, 'pick stamps the updater');
select isnt((select updated_at from public.products where name='Test apples'), (select created_at from public.products where name='Test apples'), 'product mutation advances updated_at');
select throws_ok($$ select public.toggle_product_picked((select id from public.products where name='Test apples'), 1, false) $$, 'PT409', 'product_conflict', 'stale pick returns a conflict');
select throws_ok($$ select public.adjust_product_quantity((select id from public.products where name='Test apples'), 1, 1) $$, 'PT409', 'product_conflict', 'stale quantity adjustment returns a conflict');
select throws_ok($$ select public.update_product((select id from public.products where name='Test apples'), 'Test apples', '2', '', 'other', 1) $$, 'PT409', 'product_conflict', 'stale edit returns a conflict');
select throws_ok($$ select public.delete_product((select id from public.products where name='Test apples'), 1) $$, 'PT409', 'product_conflict', 'stale deletion returns a conflict');

select lives_ok($$ select public.update_product((select id from public.products where name='Test apples'), 'Test apples', '2', 'seasonal', 'pantry', (select version from public.products where name='Test apples')) $$, 'picked product can be prepared for restore options test');
select is((select category from public.products where name='Test apples'), 'pantry', 'product category updates through the versioned RPC');
select lives_ok($$ select public.update_product((select id from public.products where name='Test apples'), 'Test apples', '2', 'seasonal', (select version from public.products where name='Test apples')) $$, 'older clients can still save through the previous RPC signature');
select is((select category from public.products where name='Test apples'), 'pantry', 'older client saves preserve the current category');
select lives_ok($$ select public.restore_all_products(true, true) $$, 'restore all succeeds');
select is((select is_picked from public.products where name='Test apples'), false, 'restore all restores picked products');
select is((select notes from public.products where name='Test apples'), null, 'restore all can clear notes');
select is((select quantity from public.products where name='Test apples'), 1::numeric, 'restore all can reset quantities');

select lives_ok($$ select public.create_product('Test milk') $$, 'second product created');
select lives_ok($$ select public.update_product((select id from public.products where name='Test milk'), 'Test milk', '3', 'keep cold', 'dairy_eggs', (select version from public.products where name='Test milk')) $$, 'second product has custom fields');
select lives_ok($$ select public.toggle_product_picked((select id from public.products where name='Test milk'), (select version from public.products where name='Test milk'), false) $$, 'second product is bought');
select lives_ok($$ select public.restore_all_products(false, false) $$, 'restore all without resets succeeds');
select is((select notes from public.products where name='Test milk'), 'keep cold', 'restore all can preserve notes');
select is((select quantity from public.products where name='Test milk'), 3::numeric, 'restore all can preserve quantities');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select lives_ok($$ select public.adjust_product_quantity((select id from public.products where name='Test milk'), 1, (select version from public.products where name='Test milk')) $$, 'member can update a product');
select lives_ok($$ select public.update_product((select id from public.products where name='Test milk'), 'Test milk', '4', 'keep cold', 'drinks', (select version from public.products where name='Test milk')) $$, 'member can update a product category');
select is((select category from public.products where name='Test milk'), 'drinks', 'member category update is stored');
select is((select updated_by from public.products where name='Test milk'), '10000000-0000-0000-0000-000000000002'::uuid, 'category mutation stamps the member as updater');

select is((select count(*) from public.households), 1::bigint, 'migration creates the first household');
select is(
  (select count(*) from public.households as h where not exists (
    select 1 from public.household_members as hm where hm.household_id = h.id
  )),
  0::bigint,
  'migration does not leave orphan households'
);
select is(
  (select hm.role from public.household_members as hm join public.profiles as p on p.id = hm.user_id where p.email = 'admin@example.com'),
  'admin',
  'migrated admin is the household admin'
);
select is(
  (select count(*) from public.household_members),
  2::bigint,
  'migrated users become household members'
);
select is(
  (select count(*) from public.products where household_id = (select household_id from public.household_members where user_id = '10000000-0000-0000-0000-000000000001'::uuid)),
  5::bigint,
  'migrated products belong to the first household'
);

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
insert into public.products(id, household_id, name, name_signature, created_by)
select
  '30000000-0000-0000-0000-000000000001'::uuid,
  household_id,
  'Cross household product',
  public.product_name_signature('Cross household product'),
  '10000000-0000-0000-0000-000000000003'::uuid
from public.household_members
where user_id = '10000000-0000-0000-0000-000000000003'::uuid;

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
select lives_ok(
  $$ select public.create_product('Test apples') $$,
  'same product name can be created in another household'
);
set local role postgres;
select is(
  (select count(*) from public.products where name = 'Test apples'),
  2::bigint,
  'duplicate product names are scoped to households'
);
set local role authenticated;
select throws_ok(
  $$ select public.create_product('APPLES test') $$,
  '23505',
  null,
  'duplicate names remain unique within a household'
);
select is((select count(*) from public.products), 2::bigint, 'member reads only the other household list');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is((select count(*) from public.products), 5::bigint, 'first household member cannot read another household products');
select throws_ok(
  $$ select public.update_product(
    '30000000-0000-0000-0000-000000000001'::uuid,
    'stolen product', '1', '', 'other',
    1
  ) $$,
  'PT409',
  'product_conflict',
  'RPC rejects mutation of another household product'
);
select is((select count(*) from public.products where name = 'stolen product'), 0::bigint, 'cross-household RPC leaves data unchanged');
select throws_ok(
  $$ select public.adjust_product_quantity('30000000-0000-0000-0000-000000000001'::uuid, 1, 1) $$,
  'PT409',
  'product_conflict',
  'cross-household quantity RPC is rejected'
);
select throws_ok(
  $$ select public.toggle_product_picked('30000000-0000-0000-0000-000000000001'::uuid, 1, false) $$,
  'PT409',
  'product_conflict',
  'cross-household pick RPC is rejected'
);
select throws_ok(
  $$ select public.delete_product('30000000-0000-0000-0000-000000000001'::uuid, 1) $$,
  'PT409',
  'product_conflict',
  'cross-household delete RPC is rejected'
);
set local role postgres;
update public.products
set is_picked = true, picked_at = now()
where id = '30000000-0000-0000-0000-000000000001'::uuid;
set local role authenticated;
select lives_ok(
  $$ select public.restore_all_products(true, true) $$,
  'restore all only updates products in the current household'
);
set local role postgres;
select is(
  (select is_picked from public.products where id = '30000000-0000-0000-0000-000000000001'::uuid),
  true,
  'cross-household restore leaves the other household product picked'
);

set local role postgres;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  instance_id, '10000000-0000-0000-0000-000000000004'::uuid, aud, role,
  'unassigned@example.com', encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change_token, reauthentication_token,
  raw_app_meta_data, '{"name":"Unassigned"}'::jsonb, now(), now()
from auth.users
where id = '10000000-0000-0000-0000-000000000001'::uuid;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
select throws_ok(
  $$ select public.create_product('No household') $$,
  '42501',
  'household_membership_required',
  'RPC requires household membership'
);
select is((select count(*) from public.products), 0::bigint, 'unassigned user cannot read products');

set local role anon;
select throws_ok(
  $$ select count(*) from public.products $$,
  '42501',
  'permission denied for table products',
  'anonymous users cannot read products'
);

select * from finish();
rollback;
