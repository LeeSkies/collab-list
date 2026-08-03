begin;
create extension if not exists pgtap with schema extensions;
select plan(120);

set local role postgres;
select has_table('public', 'household_subscriptions', 'authoritative subscription state exists');
select has_table('public', 'subscription_provider_events', 'provider webhook event log exists');
select has_table('public', 'household_billing_actions', 'admin billing intent log exists');
select is(
  (select enabled from public.feature_flags where key = 'household_entitlement_enforcement'),
  false,
  'billing enforcement defaults off behind the existing feature flag'
);
select lives_ok(
  $$ update public.household_entitlements
     set entitlement_plan = 'paid', seat_limit = 7
     where household_id = (select id from public.households order by created_at, id limit 1) $$,
  'the entitlement plan and seat allowance accept paid states'
);
select is(
  (select relrowsecurity from pg_class
   where oid = 'public.household_subscriptions'::regclass),
  true,
  'subscription state is row-level secured'
);

-- The sync seam is executable only by the service role.
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'active', now(), now() + interval '30 days',
       p_provider_event_at := now(),
       p_provider_event_id := 'evt-denied'
     ) $$,
  '42501',
  null,
  'only the service role can synchronize subscription state'
);

set local role postgres;
select throws_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'bogus', now(), now() + interval '30 days',
       p_provider_event_at := now(),
       p_provider_event_id := 'evt-bogus'
     ) $$,
  '22023', 'invalid_subscription_status',
  'the sync seam rejects unknown provider statuses'
);
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'active', now(), now() + interval '30 days',
       p_provider_event_at := now() + interval '1 minute',
       p_provider_event_id := 'evt-subscribe-1'
     ) $$,
  'a provider checkout completion can activate the paid plan'
);
select is(
  (select entitlement_plan from public.household_entitlements
   where household_id = (select id from public.households order by created_at, id limit 1)),
  'paid',
  'sync marks the household entitlement as paid'
);
select is(
  (select seat_limit from public.household_entitlements
   where household_id = (select id from public.households order by created_at, id limit 1)),
  5,
  'the base plan keeps the five-seat allowance'
);
-- The fixed base five is authoritative: the provider sync rejects any other
-- base allowance and the stored column cannot hold one.
select throws_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'active', now(), now() + interval '30 days',
       p_base_seat_allowance := 7,
       p_provider_event_at := now(),
       p_provider_event_id := 'evt-bad-base'
     ) $$,
  '22023', 'base_seat_allowance_must_be_5',
  'the provider sync rejects any base allowance other than five'
);
select throws_ok(
  $$ update public.household_subscriptions
     set base_seat_allowance = 4
     where household_id = (select id from public.households order by created_at, id limit 1) $$,
  '23514', null,
  'the stored base allowance is fixed at five'
);
select throws_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'active', now(), now() + interval '30 days',
       p_add_on_unit_amount_minor_units := 9007199254740992,
       p_currency := 'USD',
       p_provider_event_at := now(),
       p_provider_event_id := 'evt-unsafe-minor-units'
     ) $$,
  '22023', 'minor_unit_amount_out_of_range',
  'provider minor-unit amounts are constrained to JavaScript-safe integers'
);
select is(
  (select count(*) from public.subscription_provider_events where provider_event_id = 'evt-subscribe-1'),
  1::bigint,
  'the provider event is logged once'
);
-- Replaying the same provider event must not double-apply.
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'canceled', now(), now() + interval '30 days',
       p_provider_event_at := now(),
       p_provider_event_id := 'evt-subscribe-1'
     ) $$,
  'a replayed provider event is an idempotent no-op'
);
select is(
  (select status from public.household_subscriptions
   where household_id = (select id from public.households order by created_at, id limit 1)),
  'active',
  'replayed events never overwrite the applied state'
);
select is(
  (select count(*) from public.subscription_provider_events where provider_event_id = 'evt-subscribe-1'),
  1::bigint,
  'replayed events are not logged twice'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ insert into public.household_subscriptions(household_id, status, provider, provider_subscription_id, current_period_start, current_period_end)
     values ((select id from public.households order by created_at, id limit 1), 'active', 'stripe', 'sub_direct', now(), now() + interval '1 day') $$,
  '42501',
  null,
  'browser roles cannot write subscription state directly'
);

-- Approved members for the seat tests (five active total including the admin).
set local role postgres;
do $$
declare template_user auth.users;
begin
  select * into template_user from auth.users where id = '10000000-0000-0000-0000-000000000001'::uuid;
  for idx in 3..9 loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change_token, reauthentication_token,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      template_user.instance_id, ('10000000-0000-0000-0000-00000000000' || idx)::uuid, template_user.aud, template_user.role,
      'seat' || idx || '@example.com', template_user.encrypted_password, now(), template_user.confirmation_token,
      template_user.recovery_token, template_user.email_change_token_new, template_user.email_change,
      template_user.email_change_token_current, template_user.phone_change_token, template_user.reauthentication_token,
      template_user.raw_app_meta_data, ('{"name":"Seat ' || idx || '"}' )::jsonb, now(), now()
    );
  end loop;
end
$$;
select lives_ok(
  $$ insert into public.household_members(household_id, user_id, role)
     select household.id, ('10000000-0000-0000-0000-00000000000' || idx)::uuid, 'member'
     from public.households as household, generate_series(3, 5) as idx
     where household.id = (select id from public.households order by created_at, id limit 1) $$,
  'the household reaches five active members before add-on billing'
);

-- Enable enforcement for the paid lifecycle assertions.
update public.feature_flags set enabled = true where key = 'household_entitlement_enforcement';

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is(
  (select access_state from public.current_household_entitlement()),
  'paid_active',
  'an in-period subscription reports the paid active state'
);
select is(
  (select can_mutate from public.current_household_entitlement()),
  true,
  'paid active households remain fully editable'
);
select is(
  (select seat_limit from public.current_household_entitlement()),
  5,
  'the paid base plan exposes five seats'
);
select lives_ok(
  $$ select * from public.create_product('Paid period product') $$,
  'paid active households can mutate products'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select is(
  (select status from public.current_household_subscription()),
  'active',
  'members can read the authoritative subscription status'
);
select is(
  (select billing_enabled from public.current_household_subscription()),
  true,
  'billing is enabled once the feature flag is on'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000009';
select is(
  (select count(*) from public.household_subscriptions),
  0::bigint,
  'non-members cannot read subscription state through RLS'
);

-- Seat add-ons: provider-synced quantities raise the limit; approvals beyond
-- the base five need the exact configured charge and explicit confirmation.
set local role postgres;
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'active', now(), now() + interval '30 days',
       p_base_seat_allowance := 5, p_add_on_seat_count := 1,
       p_add_on_unit_amount_minor_units := 990, p_currency := 'USD',
       p_provider_event_at := now() + interval '2 minutes',
       p_provider_event_id := 'evt-addon-1'
     ) $$,
  'the provider can sync one billed add-on seat'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is(
  (select seat_limit from public.current_household_entitlement()),
  6,
  'one add-on seat raises the effective limit to six'
);
select is(
  (select active_member_count from public.current_household_subscription()),
  5::bigint,
  'the household currently has five active members'
);
select is(
  (select billed_seat_count from public.current_household_subscription()),
  0::bigint,
  'the base five seats are never billed'
);
create temp table subscription_invite as
  select * from public.invite_household_member();
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000006';
create temp table subscription_pending_request as
  select * from public.request_household_access((select invite_token from subscription_invite));
select is(
  (select status from subscription_pending_request),
  'pending',
  'a sixth request fits within the paid seat allowance'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is(
  (select billed_seat_count from public.current_household_subscription()),
  0::bigint,
  'pending requests are never billed'
);
select is(
  (select count(*) from public.household_billing_actions where action = 'add_on_seat'),
  0::bigint,
  'pending requests create no add-on charge records'
);
select throws_ok(
  $$ select * from public.approve_household_request((select request_id from subscription_pending_request)) $$,
  'P0001', 'add_on_charge_confirmation_required',
  'approving beyond the base requires explicit charge confirmation'
);
select is(
  (select status from public.approve_household_request(
     (select request_id from subscription_pending_request), true
   )),
  'approved',
  'explicit confirmation approves the add-on seat'
);
select is(
  (select active_member_count from public.current_household_subscription()),
  6::bigint,
  'the add-on seat becomes an active member'
);
select is(
  (select billed_seat_count from public.current_household_subscription()),
  1::bigint,
  'the member beyond the base is billed'
);
select is(
  (select status from public.household_billing_actions where action = 'add_on_seat' order by created_at desc limit 1),
  'applied',
  'the confirmed add-on charge is recorded for audit'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000007';
select throws_ok(
  $$ select * from public.request_household_access((select invite_token from subscription_invite)) $$,
  'P0001', 'household_capacity_reached',
  'requests stop at the paid seat limit'
);
set local role postgres;
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'active', now(), now() + interval '30 days',
       p_base_seat_allowance := 5, p_add_on_seat_count := 2,
       p_provider_event_at := now() + interval '3 minutes',
       p_provider_event_id := 'evt-addon-2'
     ) $$,
  'the provider can sync add-on seats before the charge is configured'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is(
  (select seat_limit from public.current_household_entitlement()),
  7,
  'two add-on seats raise the effective limit to seven'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000007';
create temp table subscription_pending_request_two as
  select * from public.request_household_access((select invite_token from subscription_invite));
select is(
  (select status from subscription_pending_request_two),
  'pending',
  'a seventh request fits within the expanded allowance'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select * from public.approve_household_request(
       (select request_id from subscription_pending_request_two), true
     ) $$,
  'P0001', 'add_on_charge_not_configured',
  'without a provider-supplied exact charge the add-on approval is blocked'
);
set local role postgres;
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'active', now(), now() + interval '30 days',
       p_base_seat_allowance := 5, p_add_on_seat_count := 2,
       p_add_on_unit_amount_minor_units := 990, p_currency := 'USD',
       p_provider_event_at := now() + interval '4 minutes',
       p_provider_event_id := 'evt-addon-3'
     ) $$,
  'the exact add-on charge can be supplied by the provider'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is(
  (select status from public.approve_household_request(
     (select request_id from subscription_pending_request_two), true
   )),
  'approved',
  'the confirmed add-on seat is approved once the charge exists'
);
select is(
  (select billed_seat_count from public.current_household_subscription()),
  2::bigint,
  'two members beyond the base are billed'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000008';
select throws_ok(
  $$ select * from public.request_household_access((select invite_token from subscription_invite)) $$,
  'P0001', 'household_capacity_reached',
  'the expanded paid limit is still enforced'
);

-- Admin billing intents: only the admin, only while billing is enabled, with
-- no duplicate pending intent, and the provider webhook remains the writer.
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select * from public.admin_request_billing_action('subscribe') $$,
  '42501', 'admin_required',
  'members cannot request billing actions'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select * from public.admin_request_billing_action('subscribe') $$,
  'P0001', 'subscription_already_active',
  'an active subscription rejects duplicate subscribe intents'
);
select is(
  (select status from public.admin_request_billing_action('cancel_at_period_end')),
  'pending',
  'the admin can request cancellation at period end'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select is(
  (select count(*) from public.household_billing_actions),
  0::bigint,
  'billing intents are readable only by the household admin'
);
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select * from public.admin_request_billing_action('cancel_at_period_end') $$,
  'P0001', 'billing_action_pending',
  'a pending intent is not duplicated'
);
-- The one-pending-intent contract is authoritative at the database level: the
-- unique partial index rejects a second pending row for the same household and
-- action even when written directly, while distinct actions may coexist.
set local role postgres;
select has_index(
  'public', 'household_billing_actions', 'household_billing_actions_one_pending_per_action',
  'one pending intent per household and action is enforced by a unique index'
);
select throws_ok(
  $$ insert into public.household_billing_actions(household_id, action, status, requested_by)
     select household_id, action, 'pending', '10000000-0000-0000-0000-000000000001'::uuid
     from public.household_billing_actions
     where status = 'pending'
     limit 1 $$,
  '23505', null,
  'the unique index rejects a duplicate pending intent for the same action'
);
select lives_ok(
  $$ insert into public.household_billing_actions(household_id, action, status, requested_by)
     select household_id, 'resubscribe', 'pending', '10000000-0000-0000-0000-000000000001'::uuid
     from public.household_billing_actions
     where status = 'pending'
     limit 1 $$,
  'a different action may stay pending alongside the existing intent'
);
set local role postgres;
set local role postgres;
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'active', now(), now() + interval '30 days',
       p_cancel_at_period_end := true,
       p_provider_event_at := now() + interval '5 minutes',
       p_provider_event_id := 'evt-cancel-1'
     ) $$,
  'the provider webhook applies cancellation at period end'
);
select is(
  (select cancel_at_period_end from public.household_subscriptions
   where household_id = (select id from public.households order by created_at, id limit 1)),
  true,
  'cancellation is flagged for period end'
);
select is(
  (select status from public.household_billing_actions
   where action = 'cancel_at_period_end' order by created_at desc limit 1),
  'applied',
  'the provider webhook applies the confirmed cancellation intent'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is(
  (select access_state from public.current_household_entitlement()),
  'paid_active',
  'the household stays fully usable until the paid period ends'
);
select lives_ok(
  $$ select * from public.create_product('Usable until period end') $$,
  'products remain editable until the paid period ends'
);

-- Unpaid expiry: seven-day read-only grace, then locked.
set local role postgres;
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'unpaid', now() - interval '5 days', now() - interval '1 day',
       p_cancel_at_period_end := true,
       p_provider_event_at := now() + interval '6 minutes',
       p_provider_event_id := 'evt-expire-1'
     ) $$,
  'an unpaid period expiry can be synchronized'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is(
  (select access_state from public.current_household_entitlement()),
  'read_only_grace',
  'expiry enters the seven-day read-only grace period'
);
select is(
  (select can_mutate from public.current_household_entitlement()),
  false,
  'the grace period blocks mutations'
);
select is(
  (select grace_ends_at from public.current_household_entitlement()),
  (select current_period_end from public.household_subscriptions
   where household_id = (select id from public.households order by created_at, id limit 1)) + interval '7 days',
  'grace ends exactly seven days after the paid period'
);
select throws_ok(
  $$ select * from public.create_product('Grace blocked') $$,
  '42501', 'household_read_only',
  'product mutations are blocked during paid grace'
);
select is(
  (select reads_available from public.current_household_entitlement()),
  true,
  'reads remain available during paid grace'
);
set local role postgres;
select throws_ok(
  $$ select public.require_household_entitlement_state((select id from public.households order by created_at, id limit 1)) $$,
  '42501', 'household_read_only',
  'new join requests are blocked during paid grace'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select * from public.admin_request_billing_action('cancel_at_period_end') $$,
  'P0001', 'no_active_subscription',
  'cancellation cannot target an already-ended period'
);
set local role postgres;
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'canceled', now() - interval '12 days', now() - interval '8 days',
       p_cancel_at_period_end := true,
       p_provider_event_at := now() + interval '7 minutes',
       p_provider_event_id := 'evt-expire-2'
     ) $$,
  'a fully canceled subscription can be synchronized'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is(
  (select access_state from public.current_household_entitlement()),
  'unavailable_locked',
  'the household locks after the grace period'
);
select throws_ok(
  $$ select * from public.create_product('Locked blocked') $$,
  '42501', 'household_entitlement_locked',
  'mutations are blocked after paid grace'
);
set local role postgres;
select throws_ok(
  $$ select public.require_household_entitlement_state((select id from public.households order by created_at, id limit 1)) $$,
  '42501', 'household_entitlement_locked',
  'join requests are blocked after paid grace'
);

-- Resubscription restores editing and the paid entitlement.
set local role postgres;
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'active', now(), now() + interval '30 days',
       p_cancel_at_period_end := false,
       p_base_seat_allowance := 5, p_add_on_seat_count := 2,
       p_add_on_unit_amount_minor_units := 990, p_currency := 'USD',
       p_provider_event_at := now() + interval '8 minutes',
       p_provider_event_id := 'evt-resubscribe-1'
     ) $$,
  'a provider resubscription can be synchronized'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is(
  (select access_state from public.current_household_entitlement()),
  'paid_active',
  'resubscription restores the paid active state'
);
select lives_ok(
  $$ select * from public.create_product('Resubscribed editable') $$,
  'resubscription restores editing'
);
select is(
  (select billed_seat_count from public.current_household_subscription()),
  2::bigint,
  'resubscription restores the billed add-on seats'
);
-- Provider webhook synchronization settles pending billing intents: an event
-- that cannot fulfill an intent rejects it, a later confirmation applies it,
-- and a settled intent never leaves the household permanently pending.
create temp table resubscribe_intent as
  select * from public.admin_request_billing_action('resubscribe');
select is(
  (select status from resubscribe_intent),
  'pending',
  'the admin can record a resubscribe intent'
);
set local role postgres;
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select household_id from public.household_billing_actions
        where id = (select action_id from resubscribe_intent)),
       'stripe', 'sub_test', 'active', now() - interval '10 days', now() - interval '8 days',
       p_provider_event_at := now() + interval '9 minutes',
       p_provider_event_id := 'evt-resubscribe-rejected'
     ) $$,
  'an ended provider event can reject a pending resubscribe intent'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is(
  (select status from public.household_billing_actions
   where id = (select action_id from resubscribe_intent)),
  'rejected',
  'an unfulfilled resubscribe intent is rejected rather than left pending'
);
create temp table resubscribe_intent_retry as
  select * from public.admin_request_billing_action('resubscribe');
select is(
  (select status from resubscribe_intent_retry),
  'pending',
  'a settled intent no longer blocks a fresh resubscribe request'
);
set local role postgres;
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select household_id from public.household_billing_actions
        where id = (select action_id from resubscribe_intent_retry)),
       'stripe', 'sub_test', 'active', now(), now() + interval '30 days',
       p_provider_event_at := now() + interval '10 minutes',
       p_provider_event_id := 'evt-resubscribe-applied'
     ) $$,
  'a provider confirmation can apply a fresh resubscribe intent'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is(
  (select status from public.household_billing_actions
   where id = (select action_id from resubscribe_intent_retry)),
  'applied',
  'the confirmed resubscribe intent is applied by the provider webhook'
);

-- Entitlement truth follows subscription status, not just period dates: a
-- canceled or paused subscription is never paid_active or writable even with a
-- future billing period, and only active/trialing statuses report it. An
-- active subscription flagged for cancellation stays writable until period end
-- (asserted above).
set local role postgres;
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'canceled', now(), now() + interval '30 days',
       p_cancel_at_period_end := true,
       p_provider_event_at := now() + interval '11 minutes',
       p_provider_event_id := 'evt-status-canceled-future'
     ) $$,
  'a canceled subscription with a future period can be synchronized'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select is(
  (select access_state from public.current_household_entitlement()),
  'read_only_grace',
  'a canceled future-period subscription is not paid active'
);
select is(
  (select can_mutate from public.current_household_entitlement()),
  false,
  'a canceled future-period subscription is not writable'
);
select throws_ok(
  $$ select * from public.create_product('Canceled blocked') $$,
  '42501', 'household_read_only',
  'mutations are blocked for a canceled future-period subscription'
);
select throws_ok(
  $$ select * from public.admin_request_billing_action('cancel_at_period_end') $$,
  'P0001', 'no_active_subscription',
  'canceled future-period subscriptions cannot be canceled again'
);
set local role postgres;
select throws_ok(
  $$ select public.require_household_entitlement_state((select id from public.households order by created_at, id limit 1)) $$,
  '42501', 'household_read_only',
  'new join requests are blocked for a canceled future-period subscription'
);
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'paused', now(), now() + interval '30 days',
       p_provider_event_at := now() + interval '12 minutes',
       p_provider_event_id := 'evt-status-paused-future'
     ) $$,
  'a paused subscription with a future period can be synchronized'
);
set local role authenticated;
select is(
  (select access_state from public.current_household_entitlement()),
  'read_only_grace',
  'a paused future-period subscription is not paid active'
);
select is(
  (select can_mutate from public.current_household_entitlement()),
  false,
  'a paused future-period subscription is not writable'
);
select throws_ok(
  $$ select * from public.admin_request_billing_action('cancel_at_period_end') $$,
  'P0001', 'no_active_subscription',
  'paused future-period subscriptions cannot be canceled'
);
create temp table past_due_intent as
  select * from public.admin_request_billing_action('resubscribe');
select is(
  (select status from past_due_intent),
  'pending',
  'a past-due test starts with a pending resubscribe intent'
);
set local role postgres;
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'past_due', now(), now() + interval '30 days',
       p_provider_event_at := now() + interval '13 minutes',
       p_provider_event_id := 'evt-status-past-due'
     ) $$,
  'a past-due subscription with a future period can be synchronized'
);
set local role authenticated;
select is(
  (select access_state from public.current_household_entitlement()),
  'read_only_grace',
  'only active or trialing status reports the paid active state'
);
select is(
  (select status from public.household_billing_actions
   where id = (select action_id from past_due_intent)),
  'rejected',
  'a past-due read-only event never reports a subscribe or resubscribe intent as applied'
);
select throws_ok(
  $$ select * from public.admin_request_billing_action('cancel_at_period_end') $$,
  'P0001', 'no_active_subscription',
  'past-due future-period subscriptions cannot be canceled'
);
-- Restore the active subscription so the remaining flows run against a live
-- paid household.
set local role postgres;
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'active', now(), now() + interval '30 days',
       p_cancel_at_period_end := false,
       p_base_seat_allowance := 5, p_add_on_seat_count := 2,
       p_add_on_unit_amount_minor_units := 990, p_currency := 'USD',
       p_provider_event_at := now() + interval '14 minutes',
       p_provider_event_id := 'evt-status-restore-active'
     ) $$,
  'the active subscription can be restored after the status assertions'
);
set local role authenticated;
select is(
  (select access_state from public.current_household_entitlement()),
  'paid_active',
  'the restored active subscription reports the paid active state'
);

-- Distinct provider events are ordered by the provider timestamp, not arrival
-- order. An older late event is still logged for idempotency/audit but cannot
-- overwrite the newer subscription truth.
set local role postgres;
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'canceled', now(), now() + interval '30 days',
       p_provider_event_at := now() + interval '1 hour',
       p_provider_event_id := 'evt-order-newer'
     ) $$,
  'a newer provider event updates subscription truth'
);
select is(
  (select status from public.household_subscriptions
   where household_id = (select id from public.households order by created_at, id limit 1)),
  'canceled',
  'the newer provider event is applied'
);
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select id from public.households order by created_at, id limit 1),
       'stripe', 'sub_test', 'active', now(), now() + interval '30 days',
       p_provider_event_at := now() - interval '1 hour',
       p_provider_event_id := 'evt-order-older'
     ) $$,
  'an older distinct provider event is accepted idempotently without applying'
);
select is(
  (select status from public.household_subscriptions
   where household_id = (select id from public.households order by created_at, id limit 1)),
  'canceled',
  'an older provider event cannot overwrite newer subscription truth'
);
select is(
  (select count(*) from public.subscription_provider_events
   where provider_event_id in ('evt-order-newer', 'evt-order-older')),
  2::bigint,
  'both distinct provider events remain recorded for idempotency and audit'
);
-- Equal-timestamp events use their persisted provider event ID as a
-- deterministic tie-breaker. The same two logical events produce the same
-- final truth whether the provider delivers them in either order.
create temp table equal_timestamp_households(
  forward_household_id uuid,
  reversed_household_id uuid
);
insert into equal_timestamp_households values (gen_random_uuid(), gen_random_uuid());
insert into public.households(id, name)
select forward_household_id, 'Equal timestamp forward'
from equal_timestamp_households
union all
select reversed_household_id, 'Equal timestamp reversed'
from equal_timestamp_households;
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select forward_household_id from equal_timestamp_households),
       'stripe', 'sub-tie-forward', 'canceled',
       '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
       p_provider_event_at := '2026-08-08T00:00:00Z',
       p_provider_event_id := 'evt-tie-a-forward'
     ) $$,
  'the lower equal-timestamp event is accepted when delivered first'
);
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select forward_household_id from equal_timestamp_households),
       'stripe', 'sub-tie-forward', 'active',
       '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
       p_provider_event_at := '2026-08-08T00:00:00Z',
       p_provider_event_id := 'evt-tie-z-forward'
     ) $$,
  'the higher equal-timestamp event replaces the lower event'
);
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select reversed_household_id from equal_timestamp_households),
       'stripe', 'sub-tie-reversed', 'active',
       '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
       p_provider_event_at := '2026-08-08T00:00:00Z',
       p_provider_event_id := 'evt-tie-z-reversed'
     ) $$,
  'the higher equal-timestamp event is accepted when delivered first'
);
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select reversed_household_id from equal_timestamp_households),
       'stripe', 'sub-tie-reversed', 'canceled',
       '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
       p_provider_event_at := '2026-08-08T00:00:00Z',
       p_provider_event_id := 'evt-tie-a-reversed'
     ) $$,
  'the lower equal-timestamp event cannot replace the higher event'
);
select is(
  (select status from public.household_subscriptions
   where household_id = (select forward_household_id from equal_timestamp_households)),
  'active',
  'forward equal-timestamp delivery ends in the higher event state'
);
select is(
  (select status from public.household_subscriptions
   where household_id = (select reversed_household_id from equal_timestamp_households)),
  'active',
  'reversed equal-timestamp delivery ends in the same state'
);
select is(
  (select provider_event_id from public.household_subscriptions
   where household_id = (select forward_household_id from equal_timestamp_households)),
  'evt-tie-z-forward',
  'forward delivery persists its deterministic winning event ID'
);
select is(
  (select provider_event_id from public.household_subscriptions
   where household_id = (select reversed_household_id from equal_timestamp_households)),
  'evt-tie-z-reversed',
  'reversed delivery persists its deterministic winning event ID'
);

-- A brand-new trial household has no subscription and billing stays disabled
-- until the feature flag is enabled.
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000009';
select lives_ok(
  $$ select * from public.create_household_with_trial() $$,
  'a fresh verified account can create a trial household'
);
select throws_ok(
  $$ select * from public.admin_request_billing_action('resubscribe') $$,
  'P0001', 'no_subscription_to_resubscribe',
  'resubscribe requires an existing subscription'
);
select is(
  (select status from public.admin_request_billing_action('subscribe')),
  'pending',
  'the admin can record a first subscribe intent'
);
set local role postgres;
update public.feature_flags set enabled = false where key = 'household_entitlement_enforcement';
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000009';
select is(
  (select status from public.current_household_subscription()),
  'none',
  'a trial household has no paid subscription'
);
select is(
  (select billing_enabled from public.current_household_subscription()),
  false,
  'billing is disabled while the feature flag is off'
);
select throws_ok(
  $$ select * from public.admin_request_billing_action('subscribe') $$,
  'P0001', 'billing_disabled',
  'billing intents are rejected while billing is disabled'
);
select is(
  (select access_state from public.current_household_entitlement()),
  'active_trial',
  'the trial state machine is untouched by the subscription model'
);

select * from finish();
rollback;
