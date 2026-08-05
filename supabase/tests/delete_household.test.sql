begin;
create extension if not exists pgtap with schema extensions;
select plan(69);
set local role postgres;

select has_table('public', 'deleted_households', 'deleted household recovery metadata exists');
select has_table('public', 'household_cancellation_outbox', 'purge cancellation outbox exists');
select has_column('public', 'household_cancellation_outbox', 'provider', 'outbox stores the provider when known');
select has_column('public', 'household_cancellation_outbox', 'provider_subscription_id', 'outbox stores the provider subscription when known');
select has_column('public', 'household_cancellation_outbox', 'reason', 'outbox records the purge reason');
select has_column('public', 'households', 'deleted_at', 'households have a deletion timestamp');
select has_column('public', 'households', 'deletion_expires_at', 'households have a purge deadline');
select has_function('public', 'delete_household', ARRAY['boolean'], 'admin delete RPC exists');
select has_function('public', 'recover_deleted_household', ARRAY[]::text[], 'recovery RPC exists');
select has_function('public', 'current_deleted_household', ARRAY[]::text[], 'deleted state RPC exists');
select has_function('public', 'purge_expired_deleted_households', ARRAY[]::text[], 'service purge primitive exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.deleted_households'::regclass),
  true,
  'deleted metadata is protected by RLS'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.household_cancellation_outbox'::regclass),
  true,
  'cancellation outbox is protected by RLS'
);
select is(
  has_table_privilege('authenticated', 'public.household_cancellation_outbox', 'select'),
  false,
  'browser roles cannot read the cancellation outbox'
);
select is(
  has_table_privilege('anon', 'public.household_cancellation_outbox', 'select'),
  false,
  'anonymous roles cannot read the cancellation outbox'
);
select is(
  has_function_privilege('authenticated', 'public.delete_household(boolean)', 'execute'),
  true,
  'authenticated can request deletion'
);
select is(
  has_function_privilege('authenticated', 'public.recover_deleted_household()', 'execute'),
  true,
  'authenticated can request recovery'
);
select is(
  has_function_privilege('service_role', 'public.purge_expired_deleted_households()', 'execute'),
  true,
  'service role can run expiry purge'
);
select is(
  has_function_privilege('authenticated', 'public.purge_expired_deleted_households()', 'execute'),
  false,
  'browser roles cannot run expiry purge'
);

insert into public.household_subscriptions(
  household_id, status, provider, provider_subscription_id,
  current_period_start, current_period_end, provider_event_id
) values (
  (select id from public.households order by created_at, id limit 1),
  'active', 'test', 'delete-test-sub', now(), now() + interval '30 days', 'delete-test-event'
) on conflict (household_id) do update
set status = 'active', current_period_end = now() + interval '30 days';

-- Keep an active invite and pending request in the deletion fixture. Both must
-- be purged immediately rather than surviving as replayable access grants.
do $$
declare template_user auth.users;
begin
  select * into template_user from auth.users
  where id = '10000000-0000-0000-0000-000000000001'::uuid;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change_token, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    template_user.instance_id, '10000000-0000-0000-0000-000000000200'::uuid,
    template_user.aud, template_user.role, 'delete-request@example.com',
    template_user.encrypted_password, now(), template_user.confirmation_token,
    template_user.recovery_token, template_user.email_change_token_new,
    template_user.email_change, template_user.email_change_token_current,
    template_user.phone_change_token, template_user.reauthentication_token,
    template_user.raw_app_meta_data, '{"name":"Delete Request"}'::jsonb,
    now(), now()
  );
end
$$;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
create temp table delete_invite as select * from public.invite_household_member();
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000200';
create temp table delete_request as
select * from public.request_household_access((select invite_token from delete_invite));
set local role postgres;
update public.feature_flags
set enabled = true
where key = 'household_entitlement_enforcement';
update public.household_subscriptions
set current_period_start = now() - interval '2 days',
    current_period_end = now() - interval '1 day'
where household_id = (select id from public.households order by created_at, id limit 1);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select public.delete_household(false) $$,
  'the admin can soft-delete while billing access is read-only'
);
set local role postgres;
select is(
  (select count(*) from public.deleted_households where former_admin_id = auth.uid()),
  1::bigint,
  'soft delete records the former admin recovery anchor'
);
select is(
  public.is_household_member((select household_id from public.deleted_households where former_admin_id = auth.uid())),
  false,
  'deleted households are never active memberships'
);
select is(
  (select count(*) from public.current_deleted_household()),
  1::bigint,
  'the former admin can read deleted state'
);
select is(
  (select status from public.household_subscriptions where household_id = (select household_id from public.deleted_households limit 1)),
  'active',
  'soft deletion leaves provider-owned subscription truth unchanged'
);
select is(
  (select status from public.household_billing_actions
   where household_id = (select household_id from public.deleted_households limit 1)
     and action = 'delete_household'),
  'pending',
  'soft deletion records a provider-neutral billing lifecycle intent'
);
select is(
  (select count(*) from public.household_invites where household_id = (select household_id from public.deleted_households limit 1)),
  0::bigint,
  'soft deletion purges outstanding invites'
);
select is(
  (select count(*) from public.household_join_requests where household_id = (select household_id from public.deleted_households limit 1)),
  0::bigint,
  'soft deletion purges pending access requests'
);
select is(
  (select count(*) from public.categories
   where household_id = (select household_id from public.deleted_households limit 1)),
  10::bigint,
  'soft deletion preserves the household categories'
);
select is(
  (select count(*) from public.household_member_intervals
   where household_id = (select household_id from public.deleted_households limit 1)
     and user_id = '10000000-0000-0000-0000-000000000001'::uuid
     and ended_at is not null),
  1::bigint,
  'soft deletion closes the former admin membership interval'
);
select throws_ok(
  $$ select * from public.list_household_members((select household_id from public.deleted_households limit 1)) $$,
  '42501', 'admin_required',
  'the deleted former admin cannot list members through the retained anchor'
);
select throws_ok(
  $$ select * from public.invite_household_member() $$,
  '42501', 'admin_required',
  'the deleted former admin cannot create invites through the retained anchor'
);
select throws_ok(
  $$ select * from public.remove_household_member(
       (select household_id from public.deleted_households limit 1),
       '10000000-0000-0000-0000-000000000002'::uuid
     ) $$,
  '42501', 'admin_required',
  'the deleted former admin cannot remove members through the retained anchor'
);
select throws_ok(
  $$ select * from public.list_pending_household_requests((select household_id from public.deleted_households limit 1)) $$,
  '42501', 'admin_required',
  'the deleted former admin cannot list pending requests through the retained anchor'
);
select throws_ok(
  $$ select * from public.reset_household(true, false) $$,
  '42501', 'admin_required',
  'the deleted former admin cannot reset through the retained anchor'
);
update public.feature_flags set enabled = true where key = 'household_entitlement_enforcement';
select throws_ok(
  $$ select * from public.admin_request_billing_action('resubscribe') $$,
  '42501', 'admin_required',
  'the deleted former admin cannot request billing actions through the retained anchor'
);
select is(
  (select count(*) from public.current_household_subscription()),
  0::bigint,
  'the deleted former admin cannot read subscription metadata'
);
set local role postgres;
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select household_id from public.deleted_households limit 1),
       'test', 'delete-test-sub', 'canceled', now(), now() + interval '30 days',
       p_provider_event_at := now() + interval '1 minute',
       p_provider_event_id := 'delete-test-cancel-event'
     ) $$,
  'the provider service can settle the deletion lifecycle intent'
);
select is(
  (select status from public.household_billing_actions
   where household_id = (select household_id from public.deleted_households limit 1)
     and action = 'delete_household'),
  'applied',
  'provider cancellation settles the deletion lifecycle intent'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select public.recover_deleted_household() $$,
  'the former admin can recover the household'
);
set local role postgres;
select is(
  (select count(*) from public.deleted_households),
  0::bigint,
  'recovery removes deleted state'
);
select is(
  public.is_household_member((select household_id from public.household_members where user_id = auth.uid())),
  true,
  'recovery restores the former admin anchor as active membership'
);
select is(
  (select count(*) from public.household_member_intervals
   where household_id = (select household_id from public.household_members where user_id = auth.uid())
     and user_id = auth.uid() and ended_at is null),
  1::bigint,
  'recovery reopens exactly one former admin membership interval'
);
select is(
  (select count(*) from public.categories
   where household_id = (select household_id from public.household_members where user_id = auth.uid())),
  10::bigint,
  'recovery keeps the household categories intact'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select lives_ok($$ select public.delete_household(false) $$, 'a recovered admin can request deletion again');
select lives_ok($$ select public.recover_deleted_household() $$, 'recovery can withdraw a pending deletion intent');
set local role postgres;
select is(
  (select count(*) from public.household_billing_actions
   where household_id = (select household_id from public.household_members where user_id = '10000000-0000-0000-0000-000000000001'::uuid)
     and action = 'delete_household' and status = 'pending'),
  0::bigint,
  'recovery rejects the pending deletion billing intent'
);

set local role postgres;
select is(
  (select enabled from public.feature_flags where key = 'household_entitlement_enforcement'),
  true,
  'immediate purge is exercised with entitlement enforcement enabled'
);
create temp table purge_context as
select household_id from public.household_members where user_id = '10000000-0000-0000-0000-000000000001'::uuid;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select public.delete_household(true) $$,
  'the admin can immediately purge a recovered household'
);
set local role postgres;
select is(
  (select count(*) from auth.users where id = '10000000-0000-0000-0000-000000000001'),
  1::bigint,
  'immediate purge preserves auth.users'
);
select is(
  (select count(*) from public.profiles where id = '10000000-0000-0000-0000-000000000001'),
  1::bigint,
  'immediate purge preserves profiles'
);
select is(
  (select owned_household_id from public.account_trial_eligibility where user_id = '10000000-0000-0000-0000-000000000001'),
  null,
  'immediate purge clears the owned household FK while retaining the eligibility row'
);
select is(
  (select owned_trial_started_at is not null from public.account_trial_eligibility where user_id = '10000000-0000-0000-0000-000000000001'),
  true,
  'immediate purge retains the original trial start for replacement eligibility'
);
select is(
  (select provider || ':' || provider_subscription_id
   from public.household_cancellation_outbox
   where provider_subscription_id = 'delete-test-sub'
     and reason = 'immediate_purge'),
  'test:delete-test-sub',
  'immediate purge records provider cancellation coordinates before cascade'
);
select is(
  (select status from public.household_cancellation_outbox
   where provider_subscription_id = 'delete-test-sub'
     and reason = 'immediate_purge'),
  'pending',
  'immediate purge leaves a durable pending cancellation intent'
);
select is(
  (select count(*) from public.categories where household_id = (select household_id from purge_context)),
  0::bigint,
  'immediate purge cascades the household categories'
);
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select household_id from public.household_cancellation_outbox
        where provider_subscription_id = 'delete-test-sub'),
       'test', 'delete-test-sub', 'canceled', now(), now() + interval '30 days',
       now(), p_provider_event_id := 'delete-test-immediate-cancel-event'
     ) $$,
  'service provider sync can settle an intent after immediate purge'
);
select is(
  (select status from public.household_cancellation_outbox
   where provider_subscription_id = 'delete-test-sub'
     and reason = 'immediate_purge'),
  'applied',
  'provider cancellation settles the immediate purge outbox intent'
);
update public.household_cancellation_outbox
set status = 'failed'
where provider_subscription_id = 'delete-test-sub'
  and reason = 'immediate_purge';
select lives_ok(
  $$ select public.sync_subscription_from_provider(
       (select household_id from public.household_cancellation_outbox
        where provider_subscription_id = 'delete-test-sub'),
       'test', 'delete-test-sub', 'canceled', now(), now() + interval '30 days',
       now(), p_provider_event_id := 'delete-test-immediate-cancel-retry'
     ) $$,
  'a later cancellation webhook can retry a failed outbox intent'
);
select is(
  (select status from public.household_cancellation_outbox
   where provider_subscription_id = 'delete-test-sub'
     and reason = 'immediate_purge'),
  'applied',
  'failed outbox intents settle on authoritative cancellation'
);
insert into public.households(name) values ('Expiry test household');
insert into public.household_trials(household_id, starts_at, ends_at)
select id, now(), now() + interval '14 days' from public.households where name = 'Expiry test household';
insert into public.household_subscriptions(
  household_id, status, provider, provider_subscription_id,
  current_period_start, current_period_end, provider_event_id
)
select id, 'active', 'expiry-test', 'expiry-test-sub', now(), now() + interval '30 days', 'expiry-test-event'
from public.households where name = 'Expiry test household';
insert into public.household_members(household_id, user_id, role)
select id, '10000000-0000-0000-0000-000000000001', 'admin'
from public.households where name = 'Expiry test household';
select lives_ok(
  $$ insert into public.categories(household_id, name)
     select id, 'expiry-category' from public.households where name = 'Expiry test household' $$,
  'an expiry candidate household can carry a custom category'
);
select is(
  (select count(*) from public.categories
   where household_id = (select id from public.households where name = 'Expiry test household')),
  1::bigint,
  'the expiry fixture category is present before purge'
);
select lives_ok($$ select public.delete_household(false) $$, 'an expiry candidate can be soft-deleted');
update public.deleted_households
set deleted_at = now() - interval '2 seconds', purge_at = now() - interval '1 second';
select is(public.purge_expired_deleted_households(), 1, 'the service primitive purges expired households');
select is((select count(*) from public.households where name = 'Expiry test household'), 0::bigint, 'expiry purge cascades household data');
select is(
  (select count(*) from public.categories
   where household_id = (select id from public.households where name = 'Expiry test household')),
  0::bigint,
  'expiry purge cascades the household categories'
);
select is(
  (select provider || ':' || provider_subscription_id
   from public.household_cancellation_outbox
   where household_id = (select id from public.households where name = 'Expiry test household')
      or provider_subscription_id = 'expiry-test-sub'),
  'expiry-test:expiry-test-sub',
  'expiry purge records provider cancellation coordinates before cascade'
);
select is(
  (select status from public.household_cancellation_outbox
   where provider_subscription_id = 'expiry-test-sub'),
  'pending',
  'expiry purge leaves a durable pending cancellation intent'
);
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select * from public.create_household_with_trial() $$,
  'a former admin can create a replacement household during the active trial'
);
select is(
  (select household_trials.starts_at
   from public.household_trials
   join public.household_members on household_members.household_id = household_trials.household_id
   where household_members.user_id = '10000000-0000-0000-0000-000000000001'::uuid),
  (select owned_trial_started_at
   from public.account_trial_eligibility
   where user_id = '10000000-0000-0000-0000-000000000001'::uuid),
  'replacement household reuses the original trial start'
);
select * from finish();
rollback;
