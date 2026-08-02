begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

set local role postgres;
select has_table('public', 'feature_flags', 'entitlement feature flags exist');
select is(
  (select enabled from public.feature_flags where key = 'household_entitlement_enforcement'),
  false,
  'entitlement enforcement defaults off'
);
select has_table('public', 'household_entitlements', 'household entitlements exist');
select has_table('public', 'account_trial_eligibility', 'account trial eligibility exists');
select has_table('public', 'household_member_intervals', 'membership intervals exist');
select is(
  (select seat_limit from public.household_entitlements order by household_id limit 1),
  5,
  'entitlements expose the fixed five-seat allowance'
);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is(
  (select seat_limit from public.current_household_entitlement()),
  5,
  'authenticated members can read the authoritative seat allowance'
);

set local role postgres;
-- A verified account can claim exactly one owned household trial.
do $$
declare template_user auth.users;
begin
  select * into template_user from auth.users where id = '10000000-0000-0000-0000-000000000001'::uuid;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change_token, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    template_user.instance_id, '10000000-0000-0000-0000-000000000101'::uuid, template_user.aud, template_user.role,
    'trial-owner@example.com', template_user.encrypted_password, now(), template_user.confirmation_token,
    template_user.recovery_token, template_user.email_change_token_new, template_user.email_change,
    template_user.email_change_token_current, template_user.phone_change_token, template_user.reauthentication_token,
    template_user.raw_app_meta_data, '{"name":"Trial Owner"}'::jsonb, now(), now()
  );
end
$$;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000101';
select lives_ok($$ select * from public.create_household_with_trial() $$, 'verified account can create its owned household trial');
set local role postgres;
select is(
  (select count(*)
   from public.household_trials as trial
   join public.household_members as membership on membership.household_id = trial.household_id
   where membership.user_id = '10000000-0000-0000-0000-000000000101'::uuid),
  1::bigint,
  'owned household has one authoritative trial'
);
select is(
  (select ends_at - starts_at
   from public.household_trials as trial
   join public.household_members as membership on membership.household_id = trial.household_id
   where membership.user_id = '10000000-0000-0000-0000-000000000101'::uuid),
  interval '14 days',
  'owned household trial lasts fourteen days'
);
select is(
  (select owned_household_id is not null and eligibility_consumed_at is not null
   from public.account_trial_eligibility where user_id = '10000000-0000-0000-0000-000000000101'::uuid),
  true,
  'claiming a household consumes lifetime owned-trial eligibility'
);
set local role authenticated;
select is(
  (select household_id from public.create_household_with_trial()),
  (select household_id from public.household_members where user_id = '10000000-0000-0000-0000-000000000101'::uuid),
  'retrying the same owned household is idempotent'
);
set local role postgres;
delete from public.household_members
where user_id = '10000000-0000-0000-0000-000000000101'::uuid;
set local role authenticated;
select throws_ok(
  $$ select * from public.create_household_with_trial() $$,
  'P0001', 'trial_eligibility_consumed',
  'a second owned household is rejected after eligibility is consumed'
);

-- Exposure is cumulative across approved membership intervals.
set local role postgres;
do $$
declare template_user auth.users;
begin
  select * into template_user from auth.users where id = '10000000-0000-0000-0000-000000000001'::uuid;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change_token, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    template_user.instance_id, '10000000-0000-0000-0000-000000000102'::uuid, template_user.aud, template_user.role,
    'exposure@example.com', template_user.encrypted_password, now(), template_user.confirmation_token,
    template_user.recovery_token, template_user.email_change_token_new, template_user.email_change,
    template_user.email_change_token_current, template_user.phone_change_token, template_user.reauthentication_token,
    template_user.raw_app_meta_data, '{"name":"Exposure"}'::jsonb, now(), now()
  );
  insert into public.household_members(household_id, user_id, role)
  select household.id, '10000000-0000-0000-0000-000000000102'::uuid, 'member'
  from public.households as household limit 1;
  update public.household_member_intervals
  set started_at = now() - interval '3 days'
  where user_id = '10000000-0000-0000-0000-000000000102'::uuid and ended_at is null;
  delete from public.household_members where user_id = '10000000-0000-0000-0000-000000000102'::uuid;
end
$$;
select is(
  (select exposure_days from public.account_trial_eligibility where user_id = '10000000-0000-0000-0000-000000000102'::uuid),
  3,
  'three approved calendar days are recorded after removal'
);
do $$
begin
  insert into public.household_members(household_id, user_id, role)
  select household.id, '10000000-0000-0000-0000-000000000102'::uuid, 'member'
  from public.households as household limit 1;
  update public.household_member_intervals
  set started_at = now() - interval '5 days'
  where user_id = '10000000-0000-0000-0000-000000000102'::uuid and ended_at is null;
  delete from public.household_members where user_id = '10000000-0000-0000-0000-000000000102'::uuid;
end
$$;
select is(
  (select exposure_days from public.account_trial_eligibility where user_id = '10000000-0000-0000-0000-000000000102'::uuid),
  8,
  'exposure accumulates across separate approved intervals'
);
select is(
  (select eligibility_consumed_at is not null from public.account_trial_eligibility where user_id = '10000000-0000-0000-0000-000000000102'::uuid),
  true,
  'seven cumulative approved days consume future trial eligibility'
);

-- Unverified membership rows never open an exposure interval.
do $$declare template_user auth.users;
begin
  select * into template_user from auth.users where id = '10000000-0000-0000-0000-000000000001'::uuid;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change_token, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    template_user.instance_id, '10000000-0000-0000-0000-000000000103'::uuid, template_user.aud, template_user.role,
    'unverified-exposure@example.com', template_user.encrypted_password, null, template_user.confirmation_token,
    template_user.recovery_token, template_user.email_change_token_new, template_user.email_change,
    template_user.email_change_token_current, template_user.phone_change_token, template_user.reauthentication_token,
    template_user.raw_app_meta_data, '{"name":"Unverified"}'::jsonb, now(), now()
  );
  insert into public.household_members(household_id, user_id, role)
  select household.id, '10000000-0000-0000-0000-000000000103'::uuid, 'member'
  from public.households as household limit 1;
end$$;
select is(
  (select count(*) from public.household_member_intervals where user_id = '10000000-0000-0000-0000-000000000103'::uuid),
  0::bigint,
  'unverified users do not accrue approved exposure before confirmation'
);
select set_config('test.confirmed_at', (now() - interval '2 days')::text, true);
update auth.users
set email_confirmed_at = current_setting('test.confirmed_at')::timestamptz
where id = '10000000-0000-0000-0000-000000000103'::uuid;
select is(
  (select started_at from public.household_member_intervals where user_id = '10000000-0000-0000-0000-000000000103'::uuid),
  current_setting('test.confirmed_at')::timestamptz,
  'confirmation starts the approved membership interval at confirmation time'
);
do $$ begin
  perform public.sync_account_trial_eligibility('10000000-0000-0000-0000-000000000103'::uuid);
end $$;
select is(
  (select exposure_days from public.account_trial_eligibility where user_id = '10000000-0000-0000-0000-000000000103'::uuid),
  2,
  'exposure begins at confirmation rather than membership approval'
);

-- Feature enforcement is opt-in; expired households remain editable while off.
do $$declare template_user auth.users;
begin
  select * into template_user from auth.users where id = '10000000-0000-0000-0000-000000000001'::uuid;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change_token, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    template_user.instance_id, '10000000-0000-0000-0000-000000000104'::uuid, template_user.aud, template_user.role,
    'enforcement@example.com', template_user.encrypted_password, now(), template_user.confirmation_token,
    template_user.recovery_token, template_user.email_change_token_new, template_user.email_change,
    template_user.email_change_token_current, template_user.phone_change_token, template_user.reauthentication_token,
    template_user.raw_app_meta_data, '{"name":"Enforcement"}'::jsonb, now(), now()
  );
end$$;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  instance_id, '10000000-0000-0000-0000-000000000105'::uuid, aud, role,
  'requester@example.com', encrypted_password, email_confirmed_at, confirmation_token,
  recovery_token, email_change_token_new, email_change, email_change_token_current,
  phone_change_token, reauthentication_token, raw_app_meta_data,
  '{"name":"Requester"}'::jsonb, now(), now()
from auth.users
where id = '10000000-0000-0000-0000-000000000001'::uuid;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000104';
select lives_ok($$ select * from public.create_household_with_trial() $$, 'enforcement fixture can create a trial');
select lives_ok($$ select * from public.create_product('Readable product') $$, 'expired household is editable while enforcement is off');
set local role postgres;
update public.household_trials
set starts_at = now() - interval '17 days', ends_at = now() - interval '3 days'
where household_id = (select household_id from public.household_members where user_id = '10000000-0000-0000-0000-000000000104'::uuid);
select is(
  (select access_state from public.household_entitlement_for((select household_id from public.household_members where user_id = '10000000-0000-0000-0000-000000000104'::uuid))),
  'read_only_grace',
  'expired household reports the seven-day grace state'
);
set local role authenticated;
select lives_ok($$ select * from public.create_product('Still editable') $$, 'feature flag off preserves editable behavior');
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000104';
create temp table entitlement_invite as
select * from public.invite_household_member();
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000102';
create temp table entitlement_pending_request as
select * from public.request_household_access((select invite_token from entitlement_invite));
set local role postgres;
insert into public.household_members(household_id, user_id, role)
select household_id, '10000000-0000-0000-0000-000000000101'::uuid, 'member'
from public.household_members
where user_id = '10000000-0000-0000-0000-000000000104'::uuid;
update public.feature_flags set enabled = true where key = 'household_entitlement_enforcement';

-- Direct table writes are covered as well as RPCs. Every table mutation is
-- rejected in the grace period, and product updates never evaluate NEW.user_id.
set local role postgres;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000104';
select throws_ok(
  $$ insert into public.products(household_id, name, name_signature, created_by)
     values ((select household_id from public.household_members where user_id = auth.uid()), 'Direct product insert', public.product_name_signature('Direct product insert'), auth.uid()) $$,
  '42501', 'household_read_only', 'direct product inserts are blocked in grace'
);
select throws_ok(
  $$ update public.products set notes = 'blocked' where name = 'Readable product' $$,
  '42501', 'household_read_only', 'direct product updates are blocked in grace'
);
select throws_ok(
  $$ delete from public.products where name = 'Readable product' $$,
  '42501', 'household_read_only', 'direct product deletes are blocked in grace'
);
select throws_ok(
  $$ insert into public.household_invites(household_id, token_hash, expires_at, created_by)
     values ((select household_id from public.household_members where user_id = auth.uid()), extensions.digest(convert_to('direct-invite', 'UTF8'), 'sha256'), now() + interval '1 hour', auth.uid()) $$,
  '42501', 'household_read_only', 'direct invite inserts are blocked in grace'
);
select throws_ok(
  $$ update public.household_invites set revoked_at = now()
     where household_id = (select household_id from public.household_members where user_id = auth.uid()) and revoked_at is null $$,
  '42501', 'household_read_only', 'direct invite updates are blocked in grace'
);
select throws_ok(
  $$ delete from public.household_invites
     where household_id = (select household_id from public.household_members where user_id = auth.uid()) and revoked_at is null $$,
  '42501', 'household_read_only', 'direct invite deletes are blocked in grace'
);
select throws_ok(
  $$ insert into public.household_join_requests(household_id, invite_id, user_id, expires_at)
     values (
       (select household_id from public.household_members where user_id = auth.uid()),
       (select id from public.household_invites where household_id = (select household_id from public.household_members where user_id = auth.uid()) limit 1),
       '10000000-0000-0000-0000-000000000101'::uuid,
       now() + interval '1 day'
     ) $$,
  '42501', 'household_read_only', 'direct request inserts are blocked in grace'
);
select throws_ok(
  $$ update public.household_join_requests set status = 'rejected'
     where household_id = (select household_id from public.household_members where user_id = auth.uid()) and status = 'pending' $$,
  '42501', 'household_read_only', 'direct request updates are blocked in grace'
);
select throws_ok(
  $$ delete from public.household_join_requests
     where household_id = (select household_id from public.household_members where user_id = auth.uid()) and status = 'pending' $$,
  '42501', 'household_read_only', 'direct request deletes are blocked in grace'
);
select throws_ok(
  $$ insert into public.household_members(household_id, user_id, role)
     values ((select household_id from public.household_members where user_id = auth.uid()), '10000000-0000-0000-0000-000000000101'::uuid, 'member') $$,
  '42501', 'household_read_only', 'direct member inserts are blocked in grace'
);
select throws_ok(
  $$ update public.household_members set role = 'admin' where user_id = auth.uid() $$,
  '42501', 'household_read_only', 'direct member updates are blocked in grace'
);
select throws_ok(
  $$ delete from public.household_members where user_id = auth.uid() $$,
  '42501', 'household_read_only', 'direct member deletes are blocked in grace'
);
select throws_ok(
  $$ update public.products
     set household_id = '00000000-0000-0000-0000-000000000000'::uuid
     where name = 'Readable product' $$,
  'P0001', 'household_id_change_not_allowed', 'cross-household updates are rejected before entitlement lookup'
);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000104';
select throws_ok(
  $$ select * from public.invite_household_member() $$,
  '42501', 'household_read_only',
  'feature flag on blocks new invites during read-only grace'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000105';
select throws_ok(
  $$ select * from public.request_household_access((select invite_token from entitlement_invite)) $$,
  '42501', 'household_read_only',
  'feature flag on blocks new access requests during read-only grace'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000104';
select throws_ok(
  $$ select * from public.approve_household_request((select request_id from entitlement_pending_request)) $$,
  '42501', 'household_read_only',
  'feature flag on blocks approvals during read-only grace'
);
select throws_ok(
  $$ select * from public.create_product('Grace blocked') $$,
  '42501', 'household_read_only',
  'feature flag on blocks writes during read-only grace'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000104';
select throws_ok(
  $$ select * from public.reject_household_request((select request_id from entitlement_pending_request)) $$,
  '42501', 'household_read_only',
  'feature flag on blocks request rejection during read-only grace'
);
select throws_ok(
  $$ select * from public.remove_household_member(
       (select household_id from public.household_members where user_id = auth.uid()),
       '10000000-0000-0000-0000-000000000101'::uuid
     ) $$,
  '42501', 'household_read_only',
  'feature flag on blocks member removal during read-only grace'
);
select throws_ok(
  $$ select * from public.reset_household(true, false) $$,
  '42501', 'household_read_only',
  'feature flag on blocks household reset during read-only grace'
);
select is((select count(*) from public.products), 2::bigint, 'reads remain available during read-only grace');
set local role postgres;
update public.household_trials
set starts_at = now() - interval '22 days', ends_at = now() - interval '8 days'
where household_id = (select household_id from public.household_members where user_id = '10000000-0000-0000-0000-000000000104'::uuid);
set local role authenticated;
select is(
  (select access_state from public.current_household_entitlement()),
  'unavailable_locked',
  'household reports locked after grace'
);
select throws_ok(
  $$ select * from public.create_product('Locked blocked') $$,
  '42501', 'household_entitlement_locked',
  'feature flag on blocks writes after grace'
);
select is((select count(*) from public.products), 2::bigint, 'reads remain available after grace');
set local role postgres;
update public.household_entitlements
set entitlement_plan = 'paid_placeholder'
where household_id = (select household_id from public.household_members where user_id = '10000000-0000-0000-0000-000000000104'::uuid);
set local role authenticated;
select is((select access_state from public.current_household_entitlement()), 'paid_placeholder', 'paid placeholder is authoritative');
select lives_ok($$ select * from public.create_product('Paid placeholder write') $$, 'paid placeholder remains writable');

select * from finish();
rollback;
