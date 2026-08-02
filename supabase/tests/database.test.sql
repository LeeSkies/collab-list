begin;
create extension if not exists pgtap with schema extensions;
select plan(141);

select has_table('public', 'products', 'products exists');
select has_table('public', 'households', 'households exist');
select has_table('public', 'household_members', 'household memberships exist');
select has_table('public', 'household_trials', 'household trials exist');
select has_column('public', 'household_trials', 'starts_at', 'trials record their start');
select has_column('public', 'household_trials', 'ends_at', 'trials record their end');
select has_column('public', 'products', 'household_id', 'products carry the household boundary');
select is(
  (select relreplident::text from pg_class where oid = 'public.products'::regclass),
  'f',
  'products use full replica identity for filtered realtime deletes'
);
select hasnt_table('public', 'product_pick_history', 'history table was removed');
select has_table('public', 'profiles', 'profiles exists');
select has_column('public', 'profiles', 'name', 'profiles have display names');
select has_column('public', 'profiles', 'product_tour_completed_at', 'profiles track product tour completion');
select is(
  (select count(*) from public.profiles where product_tour_completed_at is null),
  0::bigint,
  'profiles that existed before the tour are backfilled as complete'
);
set local role anon;
select throws_ok(
  $$ select * from public.complete_product_tour() $$,
  '42501',
  'permission denied for function complete_product_tour',
  'only authenticated accounts can complete the product tour'
);
set local role postgres;
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
set local role postgres;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_token,
  recovery_token, email_change_token_new, email_change, email_change_token_current,
  phone_change_token, reauthentication_token, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  instance_id, '10000000-0000-0000-0000-000000000005'::uuid, aud, role,
  'unconfirmed@example.com', encrypted_password, null, confirmation_token,
  recovery_token, email_change_token_new, email_change, email_change_token_current,
  phone_change_token, reauthentication_token, raw_app_meta_data, '{"name":"Unconfirmed"}'::jsonb, now(), now()
from auth.users
where id = '10000000-0000-0000-0000-000000000001'::uuid;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_token,
  recovery_token, email_change_token_new, email_change, email_change_token_current,
  phone_change_token, reauthentication_token, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  instance_id, '10000000-0000-0000-0000-000000000008'::uuid, aud, role,
  'long-name@example.com', encrypted_password, email_confirmed_at, confirmation_token,
  recovery_token, email_change_token_new, email_change, email_change_token_current,
  phone_change_token, reauthentication_token, raw_app_meta_data,
  jsonb_build_object('name', repeat('L', 80)), now(), now()
from auth.users
where id = '10000000-0000-0000-0000-000000000001'::uuid;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000005';
select throws_ok(
  $$ select public.create_household_with_trial() $$,
  '42501',
  'email_confirmation_required',
  'unconfirmed users cannot create a household'
);
set local role postgres;
select is((select count(*) from public.households), 2::bigint, 'unconfirmed household creation is not persisted');

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
select throws_ok(
  $$ select public.create_product('No household') $$,
  '42501',
  'household_membership_required',
  'RPC requires household membership'
);
select is((select count(*) from public.products), 0::bigint, 'unassigned user cannot read products');
select lives_ok(
  $$ select public.create_household_with_trial() $$,
  'verified unassigned user can create a household and trial'
);
set local role postgres;
select is((select count(*) from public.households), 3::bigint, 'household creation adds one household');
select is((select count(*) from public.household_trials), 1::bigint, 'household creation adds one trial');
select is(
  (select ends_at - starts_at from public.household_trials),
  interval '14 days',
  'new household trials last fourteen days'
);
select is(
  (select h.name from public.households as h join public.household_trials as t on t.household_id = h.id),
  'Unassigned''s household',
  'new households get a friendly creator-based name'
);
select is(
  (select hm.role from public.household_members as hm where hm.user_id = '10000000-0000-0000-0000-000000000004'::uuid),
  'admin',
  'household creator is the admin'
);
select is(
  (select count(*) from public.household_members where user_id = '10000000-0000-0000-0000-000000000004'::uuid),
  1::bigint,
  'household creation adds exactly one membership'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select public.create_household_with_trial() $$,
  '23505',
  'household_membership_exists',
  'members cannot create another household'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
select is(
  (select household_id from public.create_household_with_trial()),
  (select household_id from public.household_members where user_id = '10000000-0000-0000-0000-000000000004'::uuid),
  'retry returns the existing household'
);
select is(
  (select trial_ends_at - trial_starts_at from public.create_household_with_trial()),
  interval '14 days',
  'retry returns the existing trial'
);
set local role postgres;
select is((select count(*) from public.households), 3::bigint, 'retry does not create a second household');
select is((select count(*) from public.household_trials), 1::bigint, 'retry does not create a second trial');
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000008';
select lives_ok(
  $$ select public.create_household_with_trial() $$,
  'long creator names can create a household'
);
set local role postgres;
select is((select count(*) from public.households), 4::bigint, 'long-name household creation adds one household');
select is((select count(*) from public.household_trials), 2::bigint, 'long-name household creation adds one trial');
select is(
  (select char_length(h.name) from public.households as h join public.household_members as hm on hm.household_id = h.id where hm.user_id = '10000000-0000-0000-0000-000000000008'::uuid),
  80,
  'long creator names produce an eighty-character household name'
);
select is(
  (select h.name from public.households as h join public.household_members as hm on hm.household_id = h.id where hm.user_id = '10000000-0000-0000-0000-000000000008'::uuid),
  repeat('L', 68) || '''s household',
  'long creator names preserve the household suffix'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
select is((select count(*) from public.household_trials), 1::bigint, 'household members can read their household trial');
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is((select count(*) from public.household_trials), 0::bigint, 'household trial RLS hides other household trials');

-- Invite links expose only the shaped public preview, and rotation revokes
-- the previous raw token.
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
create temp table first_invite as select * from public.invite_household_member();
select isnt((select invite_token from first_invite), null, 'admin can generate an invite token');
select is((select length(invite_token) from first_invite), 64, 'invite tokens have sufficient entropy');
create temp table second_invite as select * from public.invite_household_member();
select set_config('test.invite_first', (select invite_token from first_invite), true);
select set_config('test.invite_second', (select invite_token from second_invite), true);
set local role anon;
select is(
  (select count(*) from public.preview_household_invite(current_setting('test.invite_first'))),
  0::bigint,
  'rotating an invite revokes the previous token'
);
select is(
  (select count(*) from public.preview_household_invite(current_setting('test.invite_second'))),
  1::bigint,
  'anonymous preview accepts the active invite token'
);
select throws_ok(
  $$ select token_hash from public.household_invites $$,
  '42501',
  'permission denied for table household_invites',
  'anonymous preview cannot read invite hashes'
);
set local role postgres;
update public.household_invites
set created_at = now() - interval '2 minutes',
    expires_at = now() - interval '1 minute'
where token_hash = extensions.digest(
  convert_to(current_setting('test.invite_second'), 'UTF8'), 'sha256'
);
set local role anon;
select is(
  (select count(*) from public.preview_household_invite(current_setting('test.invite_second'))),
  0::bigint,
  'expired invite links are not previewable'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
create temp table active_invite as select * from public.invite_household_member();

-- Add verified, unassigned accounts for request/capacity coverage.
set local role postgres;
do $$
declare
  template_user auth.users;
  new_id uuid;
  suffix integer;
begin
  select * into template_user from auth.users where id = '10000000-0000-0000-0000-000000000001'::uuid;
  for suffix in 9..13 loop
    new_id := format('10000000-0000-0000-0000-%s', lpad(suffix::text, 12, '0'))::uuid;
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change_token, reauthentication_token,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      template_user.instance_id, new_id, template_user.aud, template_user.role,
      format('invitee%s@example.com', suffix), template_user.encrypted_password,
      template_user.email_confirmed_at, template_user.confirmation_token,
      template_user.recovery_token, template_user.email_change_token_new,
      template_user.email_change, template_user.email_change_token_current,
      template_user.phone_change_token, template_user.reauthentication_token,
      template_user.raw_app_meta_data, jsonb_build_object('name', format('Invitee %s', suffix)),
      now(), now()
    );
  end loop;
end
$$;
select is(
  (select product_tour_completed_at is null from public.profiles where email = 'invitee9@example.com'),
  true,
  'accounts created after the tour migration start incomplete'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000009';
create temp table first_tour_completion as select * from public.complete_product_tour();
select is(
  (select product_tour_completed_at is not null from first_tour_completion),
  true,
  'the authenticated account can complete the product tour'
);
create temp table second_tour_completion as select * from public.complete_product_tour();
select is(
  (select product_tour_completed_at from second_tour_completion),
  (select product_tour_completed_at from first_tour_completion),
  'product tour completion is idempotent for the account'
);
create temp table first_request as
select * from public.request_household_access((select invite_token from active_invite));
select is((select status from first_request), 'pending', 'verified invitee can request access');
select is(
  (select expires_at - now() > interval '6 days' from first_request),
  true,
  'join requests expire seven days after creation'
);
create temp table duplicate_request as
select * from public.request_household_access((select invite_token from active_invite));
select is(
  (select request_id from duplicate_request),
  (select request_id from first_request),
  'reopening a pending invite request is idempotent'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000010';
select lives_ok(
  $$ select * from public.request_household_access((select invite_token from active_invite)) $$,
  'second pending request is accepted'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000011';
select lives_ok(
  $$ select * from public.request_household_access((select invite_token from active_invite)) $$,
  'third pending request is accepted within the five-seat limit'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000012';
select throws_ok(
  $$ select * from public.request_household_access((select invite_token from active_invite)) $$,
  'P0001',
  'household_capacity_reached',
  'pending requests reserve the remaining member seats'
);
set local role postgres;
update public.household_join_requests
set created_at = now() - interval '2 minutes',
    expires_at = now() - interval '1 minute'
where user_id = '10000000-0000-0000-0000-000000000011'::uuid;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.list_pending_household_requests((select household_id from public.household_members where user_id = auth.uid())) where name = 'Invitee 11'),
  0::bigint,
  'expired requests release their pending seat'
);
select is((select status from public.approve_household_request((select request_id from first_request))), 'approved', 'admin approval adds a member atomically');
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000010';
select is((select count(*) from public.household_members where user_id = auth.uid()), 0::bigint, 'unapproved invitees have no membership');
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is((select status from public.approve_household_request((select id from public.household_join_requests where user_id = '10000000-0000-0000-0000-000000000010'::uuid))), 'approved', 'second request can be approved');
select is((select status from public.approve_household_request((select id from public.household_join_requests where user_id = '10000000-0000-0000-0000-000000000011'::uuid))), 'expired', 'admin cannot approve an expired request');
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000012';
select lives_ok(
  $$ select * from public.request_household_access((select invite_token from active_invite)) $$,
  'released expired seat can be requested again'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is((select count(*) from public.household_members where household_id = (select household_id from public.household_members where user_id = auth.uid())), 4::bigint, 'approved members are counted in the household');
select is((select status from public.reject_household_request((select id from public.household_join_requests where user_id = '10000000-0000-0000-0000-000000000012'::uuid))), 'rejected', 'admin rejection releases a request');
create temp table fresh_invite as select * from public.invite_household_member();
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000012';
select is((select status from public.request_household_access((select invite_token from fresh_invite))), 'pending', 'a rejected account can request again with a fresh invite');
select is((select status from public.current_household_invite_request((select invite_token from fresh_invite))), 'pending', 'request status is scoped to the invite token');

-- The account-level unique membership constraint also blocks joining a second household.
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';
create temp table other_household_invite as select * from public.invite_household_member();
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000009';
select throws_ok(
  $$ select * from public.request_household_access((select invite_token from other_household_invite)) $$,
  '23505',
  'account_belongs_to_another_household',
  'an account cannot join another household'
);

-- Admin membership management is scoped to one household and never uses
-- account-level deletion. Removing a member also revokes the invite that was
-- active at removal time; pending notifications remain for admin handling.
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
create temp table removal_invite as select * from public.invite_household_member();
select is(
  (select count(*) from public.list_household_members((select household_id from public.household_members where user_id = auth.uid()))),
  4::bigint,
  'an admin can list all current household members'
);
select is(
  (select email from public.list_household_members((select household_id from public.household_members where user_id = auth.uid())) where user_id = '10000000-0000-0000-0000-000000000002'::uuid),
  'member@example.com',
  'member list returns a shaped profile for each member'
);
select throws_ok(
  $$ select * from public.remove_household_member((select household_id from public.household_members where user_id = auth.uid()), auth.uid()) $$,
  'P0001',
  'member_self_removal',
  'an admin cannot remove themself'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000009';
select throws_ok(
  $$ select * from public.list_household_members('00000000-0000-0000-0000-000000000000'::uuid) $$,
  '42501',
  'admin_required',
  'a regular member cannot list household members through the admin RPC'
);
select throws_ok(
  $$ select * from public.remove_household_member('00000000-0000-0000-0000-000000000000'::uuid, '10000000-0000-0000-0000-000000000010'::uuid) $$,
  '42501',
  'admin_required',
  'a regular member cannot remove a household member through the admin RPC'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is(
  (select user_id from public.remove_household_member(
    (select household_id from public.household_members where user_id = auth.uid()),
    '10000000-0000-0000-0000-000000000002'::uuid
  )),
  '10000000-0000-0000-0000-000000000002'::uuid,
  'an admin can remove another member'
);
select is(
  (select count(*) from public.household_members where user_id = '10000000-0000-0000-0000-000000000002'::uuid),
  0::bigint,
  'removal deletes only the household membership row'
);
select is(
  (select count(*) from public.list_household_members((select household_id from public.household_members where user_id = auth.uid())) where user_id = '10000000-0000-0000-0000-000000000002'::uuid),
  0::bigint,
  'removed members no longer appear in the admin member list'
);
set local role postgres;
select is((select count(*) from auth.users where id = '10000000-0000-0000-0000-000000000002'::uuid), 1::bigint, 'removal leaves the auth user intact');
select is((select count(*) from public.profiles where id = '10000000-0000-0000-0000-000000000002'::uuid), 1::bigint, 'removal leaves the profile intact');
select is((select email from public.profiles where id = '10000000-0000-0000-0000-000000000002'::uuid), 'member@example.com', 'removal does not change the login email');
set local role authenticated;
select is(
  (select status from public.household_join_requests where user_id = '10000000-0000-0000-0000-000000000012'::uuid and status = 'pending' limit 1),
  'pending',
  'pending request notifications remain until handled'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select * from public.request_household_access((select invite_token from removal_invite)) $$,
  '22023',
  'invite_invalid_or_expired',
  'a removed member cannot reuse the invite active before removal'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
create temp table rotated_after_removal as select * from public.invite_household_member();
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select is(
  (select status from public.request_household_access((select invite_token from rotated_after_removal))),
  'pending',
  'a removed member can request again only with a newly rotated invite'
);

set local role anon;
select throws_ok(
  $$ select count(*) from public.products $$,
  '42501',
  'permission denied for table products',
  'anonymous users cannot read products'
);
select throws_ok(
  $$ select count(*) from public.household_trials $$,
  '42501',
  'permission denied for table household_trials',
  'anonymous users cannot read household trials'
);

select * from finish();
rollback;
