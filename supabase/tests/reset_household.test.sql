begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

set local role postgres;
create temp table reset_context as
select
  h.id as household_id,
  (select user_id from public.household_members where household_id = h.id and role = 'admin') as admin_id,
  (select id from public.household_trials where household_id = h.id) as trial_id,
  (select user_id from public.household_members where household_id = h.id and role = 'member' limit 1) as member_id
from public.households as h
order by h.created_at, h.id
limit 1;

insert into public.household_trials(household_id, starts_at, ends_at)
select household_id, '2026-08-06 10:00:00+00', '2026-08-20 10:00:00+00'
from reset_context
where trial_id is null;
update reset_context
set trial_id = (select household_trials.household_id from public.household_trials where household_id = reset_context.household_id);
grant select on reset_context to authenticated;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  instance_id, '10000000-0000-0000-0000-000000000099'::uuid, aud, role,
  'reset-request@example.com', encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change_token, reauthentication_token,
  raw_app_meta_data, '{"name":"Reset Request"}'::jsonb, now(), now()
from auth.users
where id = (select admin_id from reset_context);

create temp table reset_invite as
select id
from public.household_invites
where false;
with inserted_invite as (
  insert into public.household_invites(household_id, token_hash, expires_at, created_by)
  select household_id, extensions.digest(convert_to('reset-invite', 'UTF8'), 'sha256'), now() + interval '1 hour', admin_id
  from reset_context
  returning id
)
insert into reset_invite
select id from inserted_invite;
insert into public.household_join_requests(household_id, invite_id, user_id, expires_at)
select context.household_id, invite.id, '10000000-0000-0000-0000-000000000099'::uuid, now() + interval '1 day'
from reset_context as context
cross join reset_invite as invite;

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select * from public.reset_household(true, false) $$,
  '42501',
  'admin_required',
  'a regular member cannot reset a household'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select * from public.reset_household(false, false) $$,
  'P0001',
  'reset_choice_required',
  'reset requires at least one selected choice'
);

create temp table before_clear as
select count(*)::bigint as product_count
from public.products
where household_id = (select household_id from reset_context);
select * from public.create_product('Reset clear-only product');
create temp table clear_result as select * from public.reset_household(true, false);
select is(
  (select products_deleted from clear_result),
  (select product_count + 1 from before_clear),
  'clear-products reset reports every deleted product'
);
select is(
  (select count(*) from public.products where household_id = (select household_id from reset_context)),
  0::bigint,
  'clear-products reset deletes all products'
);
select is(
  (select count(*) from public.categories where household_id = (select household_id from reset_context)),
  10::bigint,
  'clear-products reset preserves the seeded categories'
);
select is(
  (select count(*) from public.household_members where household_id = (select household_id from reset_context)),
  2::bigint,
  'clear-products reset preserves all memberships'
);
select is(
  (select count(*) from public.household_join_requests where household_id = (select household_id from reset_context)),
  1::bigint,
  'clear-products reset preserves pending requests'
);
set local role postgres;
select is(
  (select count(*) from public.household_invites where household_id = (select household_id from reset_context) and revoked_at is null),
  1::bigint,
  'clear-products reset preserves active invites'
);
set local role authenticated;
select is(
  (select count(*) from public.households where id = (select household_id from reset_context)),
  1::bigint,
  'clear-products reset preserves the household'
);
select is(
  (select count(*) from public.household_members where household_id = (select household_id from reset_context) and user_id = (select admin_id from reset_context) and role = 'admin'),
  1::bigint,
  'clear-products reset preserves the admin'
);
select is(
  (select count(*) from public.household_trials where household_id = (select household_id from reset_context)),
  1::bigint,
  'clear-products reset preserves trial details'
);

select * from public.create_product('Reset members-only product');
create temp table members_result as select * from public.reset_household(false, true);
select is((select products_deleted from members_result), 0::bigint, 'members-only reset deletes no products');
select is((select count(*) from public.products where household_id = (select household_id from reset_context)), 1::bigint, 'members-only reset preserves products');
select is((select members_removed from members_result), 1::bigint, 'members-only reset reports removed members');
select is((select count(*) from public.household_members where household_id = (select household_id from reset_context)), 1::bigint, 'members-only reset keeps only the admin membership');
select is((select count(*) from public.household_join_requests where household_id = (select household_id from reset_context)), 0::bigint, 'members-only reset removes pending requests');
set local role postgres;
select is((select count(*) from public.household_invites where household_id = (select household_id from reset_context) and revoked_at is null), 0::bigint, 'members-only reset revokes active invites');

select is((select count(*) from auth.users where id = (select member_id from reset_context)), 1::bigint, 'member reset preserves the auth user');
select is((select count(*) from public.profiles where id = (select member_id from reset_context)), 1::bigint, 'member reset preserves the profile');
insert into public.household_members(household_id, user_id, role)
select household_id, member_id, 'member' from reset_context;
set local role authenticated;
select * from public.create_product('Reset both-options product');
create temp table both_result as select * from public.reset_household(true, true);
select is((select products_deleted from both_result), 2::bigint, 'both-options reset deletes all remaining products');
select is((select count(*) from public.products where household_id = (select household_id from reset_context)), 0::bigint, 'both-options reset leaves no products or product history rows');
select is(
  (select count(*) from public.categories where household_id = (select household_id from reset_context)),
  10::bigint,
  'both-options reset preserves the seeded categories'
);
select is((select members_removed from both_result), 1::bigint, 'both-options reset removes the non-admin member');
select is((select count(*) from public.household_members where household_id = (select household_id from reset_context) and role = 'admin'), 1::bigint, 'both-options reset preserves the admin membership');
select is((select count(*) from public.households where id = (select household_id from reset_context)), 1::bigint, 'both-options reset preserves the household');
select is((select count(*) from public.household_trials where household_id = (select household_id from reset_context)), 1::bigint, 'both-options reset preserves the trial');
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select * from public.reset_household(true, false) $$,
  '42501',
  'admin_required',
  'a removed member cannot invoke reset'
);

set local role postgres;
select is((select count(*) from auth.users where id = (select member_id from reset_context)), 1::bigint, 'both-options reset preserves removed auth users');
select is((select count(*) from public.profiles where id = (select member_id from reset_context)), 1::bigint, 'both-options reset preserves removed profiles');
select hasnt_table('public', 'product_pick_history', 'reset does not introduce a product history table');

select * from finish();
rollback;
