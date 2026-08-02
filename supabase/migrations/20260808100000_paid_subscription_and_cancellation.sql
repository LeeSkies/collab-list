-- Paid subscription and cancellation (ticket 08).
--
-- Design contract (provider-neutral seam):
-- * `household_subscriptions` is the authoritative application-side subscription
--   state. It is written ONLY through `sync_subscription_from_provider`, which
--   is executable only by the service role (Edge Functions). No browser path,
--   RLS policy, or client RPC can write subscription state.
-- * `subscription_provider_events` is an append-only idempotency log keyed by
--   (provider, provider_event_id) so webhook replays apply exactly once.
-- * `household_billing_actions` records explicit admin billing intents
--   (subscribe, cancel at period end, resubscribe) and confirmed add-on-seat
--   approvals. A future provider integration consumes these; the webhook sync
--   remains the only writer of subscription truth.
-- * Pricing amount, currency, taxes, and the checkout contract are NOT decided
--   here. The add-on unit amount is stored only when a provider supplies it;
--   enforcement rejects add-on approvals with a clear error until it exists.
-- * The existing `household_entitlement_enforcement` feature flag keeps billing
--   disabled by default. Sync still records provider truth while the flag is
--   off so state is correct the moment enforcement is enabled.
-- * The base plan allowance is five active members; pending requests reserve
--   capacity but are never billed. Billed seats are active members beyond the
--   base allowance, mirrored by the provider-synced add-on seat count.

-- Relax the placeholder-only entitlement plan and fixed five-seat constraint.
-- The stored seat_limit remains the authoritative allowance for trial
-- households and is maintained by the provider sync for paid households.
alter table public.household_entitlements
  drop constraint if exists household_entitlements_entitlement_plan_check;
alter table public.household_entitlements
  add constraint household_entitlements_entitlement_plan_check
  check (entitlement_plan in ('trial', 'paid_placeholder', 'paid'));
alter table public.household_entitlements
  drop constraint if exists household_entitlements_seat_limit_check;
alter table public.household_entitlements
  add constraint household_entitlements_seat_limit_check
  check (seat_limit >= 1);

create table public.household_subscriptions (
  household_id uuid primary key references public.households(id) on delete cascade,
  status text not null
    check (status in ('trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused')),
  provider text not null,
  provider_subscription_id text not null,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  base_seat_allowance integer not null default 5 check (base_seat_allowance = 5),
  add_on_seat_count integer not null default 0 check (add_on_seat_count >= 0),
  add_on_unit_amount_minor_units bigint
    check (
      add_on_unit_amount_minor_units is null
      or add_on_unit_amount_minor_units between 0 and 9007199254740991
    ),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  provider_event_at timestamptz not null default now(),
  provider_event_id text not null,
  constraint household_subscriptions_period_dates check (current_period_end > current_period_start),
  constraint household_subscriptions_charge_pair check (
    (add_on_unit_amount_minor_units is null) = (currency is null)
  )
);

create trigger household_subscriptions_updated_at
before update on public.household_subscriptions
for each row execute function public.set_updated_at();

create table public.subscription_provider_events (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  provider text not null,
  provider_event_id text not null,
  provider_subscription_id text,
  provider_event_at timestamptz not null default now(),
  applied_at timestamptz not null default now(),
  constraint subscription_provider_events_unique unique (provider, provider_event_id)
);

create index subscription_provider_events_household_idx
  on public.subscription_provider_events(household_id, applied_at desc);

create table public.household_billing_actions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  action text not null check (action in ('subscribe', 'cancel_at_period_end', 'resubscribe', 'add_on_seat')),
  status text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  detail jsonb not null default '{}'::jsonb,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index household_billing_actions_household_idx
  on public.household_billing_actions(household_id, created_at desc);

-- Authoritative one-pending-intent contract: at most one pending intent per
-- household and action. Settled rows (applied/rejected) are excluded so the
-- same action can be requested again after the provider settles it.
create unique index household_billing_actions_one_pending_per_action
  on public.household_billing_actions(household_id, action)
  where status = 'pending';

create trigger household_billing_actions_updated_at
before update on public.household_billing_actions
for each row execute function public.set_updated_at();

alter table public.household_subscriptions enable row level security;
alter table public.subscription_provider_events enable row level security;
alter table public.household_billing_actions enable row level security;

revoke all on public.household_subscriptions from anon, authenticated;
revoke all on public.subscription_provider_events from anon, authenticated;
revoke all on public.household_billing_actions from anon, authenticated;

-- Members may read subscription facts (plan, seats, period) for boundary
-- messaging. Billing intents are admin-only reads. Nothing is directly
-- writable through RLS; the service-role sync function is the only writer.
create policy household_subscriptions_read_member
on public.household_subscriptions for select
to authenticated
using (public.is_household_member(household_id));

create policy household_billing_actions_read_admin
on public.household_billing_actions for select
to authenticated
using (
  exists (
    select 1
    from public.household_members as membership
    where membership.household_id = household_billing_actions.household_id
      and membership.user_id = auth.uid()
      and membership.role = 'admin'
  )
);

grant select on public.household_subscriptions to authenticated;
grant select on public.household_billing_actions to authenticated;

-- The authoritative provider-to-application sync point. Executable only by the
-- service role. Replays of the same provider event are idempotent no-ops. A
-- provider event timestamp protects newer subscription truth from late events;
-- equal timestamps from distinct event IDs are ordered lexically by their
-- persisted provider event ID, so arrival order cannot change subscription truth.
drop function if exists public.sync_subscription_from_provider(
  uuid, text, text, text, timestamptz, timestamptz, boolean, timestamptz,
  integer, integer, bigint, text, text
);

create or replace function public.sync_subscription_from_provider(
  p_household_id uuid,
  p_provider text,
  p_provider_subscription_id text,
  p_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_provider_event_at timestamptz,
  p_cancel_at_period_end boolean default false,
  p_canceled_at timestamptz default null,
  p_base_seat_allowance integer default 5,
  p_add_on_seat_count integer default 0,
  p_add_on_unit_amount_minor_units bigint default null,
  p_currency text default null,
  p_provider_event_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_applied boolean;
  subscription_applied boolean;
  event_at timestamptz := p_provider_event_at;
begin
  if p_provider_event_id is null then
    raise exception using errcode = '22023', message = 'provider_event_id_required';
  end if;
  if event_at is null then
    raise exception using errcode = '22023', message = 'provider_event_at_required';
  end if;
  if p_status not in ('trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused') then
    raise exception using errcode = '22023', message = 'invalid_subscription_status';
  end if;
  if p_current_period_start is null or p_current_period_end is null
     or p_current_period_end <= p_current_period_start then
    raise exception using errcode = '22023', message = 'invalid_subscription_period';
  end if;
  if p_base_seat_allowance is null or p_base_seat_allowance <> 5 then
    raise exception using errcode = '22023', message = 'base_seat_allowance_must_be_5';
  end if;
  if p_add_on_seat_count is null or p_add_on_seat_count < 0 then
    raise exception using errcode = '22023', message = 'invalid_seat_allowance';
  end if;
  if (p_add_on_unit_amount_minor_units is null) <> (p_currency is null) then
    raise exception using errcode = '22023', message = 'incomplete_add_on_charge';
  end if;
  if p_add_on_unit_amount_minor_units is not null
     and p_add_on_unit_amount_minor_units > 9007199254740991 then
    raise exception using errcode = '22023', message = 'minor_unit_amount_out_of_range';
  end if;
  if p_currency is not null and p_currency !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22023', message = 'invalid_currency';
  end if;

  insert into public.subscription_provider_events(
    household_id, provider, provider_event_id, provider_subscription_id, provider_event_at
  ) values (
    p_household_id, p_provider, p_provider_event_id, p_provider_subscription_id, event_at
  )
  on conflict (provider, provider_event_id) do nothing
  returning true into event_applied;

  if event_applied is null then
    return;
  end if;

  insert into public.household_subscriptions(
    household_id, status, provider, provider_subscription_id,
    current_period_start, current_period_end,
    cancel_at_period_end, canceled_at,
    base_seat_allowance, add_on_seat_count,
    add_on_unit_amount_minor_units, currency, provider_event_at, provider_event_id
  ) values (
    p_household_id, p_status, p_provider, p_provider_subscription_id,
    p_current_period_start, p_current_period_end,
    coalesce(p_cancel_at_period_end, false), p_canceled_at,
    coalesce(p_base_seat_allowance, 5), coalesce(p_add_on_seat_count, 0),
    p_add_on_unit_amount_minor_units, p_currency, event_at, p_provider_event_id
  )
  on conflict (household_id) do update set
    status = excluded.status,
    provider = excluded.provider,
    provider_subscription_id = excluded.provider_subscription_id,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    canceled_at = excluded.canceled_at,
    base_seat_allowance = excluded.base_seat_allowance,
    add_on_seat_count = excluded.add_on_seat_count,
    add_on_unit_amount_minor_units = excluded.add_on_unit_amount_minor_units,
    currency = excluded.currency,
    provider_event_at = excluded.provider_event_at,
    provider_event_id = excluded.provider_event_id
  where (excluded.provider_event_at, excluded.provider_event_id)
      > (household_subscriptions.provider_event_at, household_subscriptions.provider_event_id)
  returning true into subscription_applied;

  if subscription_applied is null then
    return;
  end if;

  update public.household_entitlements
  set entitlement_plan = 'paid',
      seat_limit = coalesce(p_base_seat_allowance, 5) + coalesce(p_add_on_seat_count, 0)
  where household_id = p_household_id;

  -- Settle pending admin billing intents from the confirmed provider state so
  -- no intent can remain pending forever. Only a writable in-period subscription
  -- applies subscribe/resubscribe intents; read-only statuses reject them.
  -- Cancellation intents are applied when the provider confirms cancellation
  -- at period end and rejected when the event contradicts the request.
  if p_status in ('trialing', 'active') and now() < p_current_period_end then
    update public.household_billing_actions
    set status = 'applied'
    where household_id = p_household_id and status = 'pending'
      and action in ('subscribe', 'resubscribe');
  else
    update public.household_billing_actions
    set status = 'rejected'
    where household_id = p_household_id and status = 'pending'
      and action in ('subscribe', 'resubscribe');
  end if;

  if p_cancel_at_period_end then
    update public.household_billing_actions
    set status = 'applied'
    where household_id = p_household_id and status = 'pending'
      and action = 'cancel_at_period_end';
  else
    update public.household_billing_actions
    set status = 'rejected'
    where household_id = p_household_id and status = 'pending'
      and action = 'cancel_at_period_end';
  end if;
end
$$;

revoke all on function public.sync_subscription_from_provider(
  uuid, text, text, text, timestamptz, timestamptz, timestamptz, boolean,
  timestamptz, integer, integer, bigint, text, text
) from public;
grant execute on function public.sync_subscription_from_provider(
  uuid, text, text, text, timestamptz, timestamptz, timestamptz, boolean,
  timestamptz, integer, integer, bigint, text, text
) to service_role;

-- The effective seat allowance depends on the enforcement flag and the live
-- paid subscription. Unassigned requesters rely on it, so it does not require
-- household membership; it is callable only from server-side definer paths.
create or replace function public.household_effective_seat_limit(p_household_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.entitlement_enforcement_enabled() then 5
    when exists (
      select 1 from public.household_subscriptions as subscription
      where subscription.household_id = p_household_id
        and now() < subscription.current_period_end
    ) then (
      select subscription.base_seat_allowance + subscription.add_on_seat_count
      from public.household_subscriptions as subscription
      where subscription.household_id = p_household_id
    )
    else 5
  end
$$;

revoke all on function public.household_effective_seat_limit(uuid) from public;

-- Paid households follow the period/grace/lock state machine; cancellation
-- takes effect only at period end. The trial machine remains unchanged for
-- households without a subscription.
create or replace function public.household_entitlement_for(p_household_id uuid)
returns table (
  household_id uuid,
  access_state text,
  trial_starts_at timestamptz,
  trial_ends_at timestamptz,
  grace_ends_at timestamptz,
  seat_limit integer,
  enforcement_enabled boolean,
  can_mutate boolean,
  reads_available boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  trial_row public.household_trials;
  plan_name text;
  enforcement boolean := public.entitlement_enforcement_enabled();
  subscription_row public.household_subscriptions;
begin
  if not exists (
    select 1 from public.household_members as membership
    where membership.household_id = p_household_id and membership.user_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'household_membership_required';
  end if;

  select * into trial_row
  from public.household_trials
  where household_trials.household_id = p_household_id;
  select entitlement.entitlement_plan into plan_name
  from public.household_entitlements as entitlement
  where entitlement.household_id = p_household_id;
  select * into subscription_row
  from public.household_subscriptions as subscription
  where subscription.household_id = p_household_id;

  household_id := p_household_id;
  trial_starts_at := trial_row.starts_at;
  trial_ends_at := trial_row.ends_at;
  grace_ends_at := trial_row.ends_at + interval '7 days';
  seat_limit := coalesce(
    (select entitlement.seat_limit from public.household_entitlements as entitlement where entitlement.household_id = p_household_id),
    5
  );
  enforcement_enabled := enforcement;
  reads_available := true;

  if plan_name = 'paid_placeholder' then
    access_state := 'paid_placeholder';
  elsif subscription_row.household_id is not null then
    seat_limit := subscription_row.base_seat_allowance + subscription_row.add_on_seat_count;
    grace_ends_at := subscription_row.current_period_end + interval '7 days';
    -- Only a live active or trialing subscription is writable. Canceled and
    -- paused rows stay read-only even inside a future billing period, while an
    -- active subscription flagged cancel_at_period_end remains writable until
    -- its period ends.
    if now() < subscription_row.current_period_end
       and subscription_row.status in ('trialing', 'active') then
      access_state := 'paid_active';
    elsif now() < subscription_row.current_period_end + interval '7 days' then
      access_state := 'read_only_grace';
    else
      access_state := 'unavailable_locked';
    end if;
  elsif now() < trial_row.ends_at then
    access_state := 'active_trial';
  elsif now() < trial_row.ends_at + interval '7 days' then
    access_state := 'read_only_grace';
  else
    access_state := 'unavailable_locked';
  end if;
  can_mutate := not enforcement or access_state in ('active_trial', 'paid_placeholder', 'paid_active');
  return next;
end
$$;

-- The unassigned-requester boundary must accept requests for paid households
-- that are still inside their paid period.
create or replace function public.require_household_entitlement_state(p_household_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  trial_ends timestamptz;
  plan_name text;
  subscription_row public.household_subscriptions;
begin
  if not public.entitlement_enforcement_enabled() then
    return p_household_id;
  end if;
  select trial.ends_at, entitlement.entitlement_plan
  into trial_ends, plan_name
  from public.household_trials as trial
  left join public.household_entitlements as entitlement
    on entitlement.household_id = trial.household_id
  where trial.household_id = p_household_id;

  select * into subscription_row
  from public.household_subscriptions
  where household_id = p_household_id;

  if plan_name = 'paid_placeholder' then
    return p_household_id;
  end if;
  if subscription_row.household_id is not null then
    if now() < subscription_row.current_period_end
       and subscription_row.status in ('trialing', 'active') then
      return p_household_id;
    end if;
    if now() < subscription_row.current_period_end + interval '7 days' then
      raise exception using errcode = '42501', message = 'household_read_only';
    end if;
    raise exception using errcode = '42501', message = 'household_entitlement_locked';
  end if;
  if trial_ends is not null and now() < trial_ends then
    return p_household_id;
  end if;
  if trial_ends is not null and now() < trial_ends + interval '7 days' then
    raise exception using errcode = '42501', message = 'household_read_only';
  end if;
  raise exception using errcode = '42501', message = 'household_entitlement_locked';
end
$$;

-- Admin-only, provider-neutral billing intent. The webhook sync is the only
-- path that changes subscription truth; these rows are the seam a future
-- provider integration consumes.
create or replace function public.admin_request_billing_action(p_action text)
returns table (
  action_id uuid,
  action text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_household_id uuid;
  created_action_id uuid;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_action not in ('subscribe', 'cancel_at_period_end', 'resubscribe') then
    raise exception using errcode = '22023', message = 'invalid_billing_action';
  end if;
  if not public.entitlement_enforcement_enabled() then
    raise exception using errcode = 'P0001', message = 'billing_disabled';
  end if;

  select membership.household_id into current_household_id
  from public.household_members as membership
  where membership.user_id = current_user_id and membership.role = 'admin';
  if current_household_id is null then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;

  -- Serialize intent requests on the household row so concurrent calls cannot
  -- both pass the pending-intent check; the unique partial index above remains
  -- the authoritative backstop for any writer that bypasses this function.
  perform 1 from public.households where id = current_household_id for update;

  -- Validate the target state first so an already-ended subscription reports
  -- the real reason rather than a stale duplicate-intent guard.
  if p_action = 'cancel_at_period_end' then
    if not exists (
      select 1 from public.household_subscriptions as subscription
      where subscription.household_id = current_household_id
        and subscription.status in ('trialing', 'active')
        and subscription.cancel_at_period_end = false
        and now() < subscription.current_period_end
    ) then
      raise exception using errcode = 'P0001', message = 'no_active_subscription';
    end if;
  elsif p_action = 'subscribe' then
    if exists (
      select 1 from public.household_subscriptions as subscription
      where subscription.household_id = current_household_id
        and subscription.status in ('trialing', 'active', 'past_due')
        and now() < subscription.current_period_end
    ) then
      raise exception using errcode = 'P0001', message = 'subscription_already_active';
    end if;
  elsif p_action = 'resubscribe' then
    if not exists (
      select 1 from public.household_subscriptions as subscription
      where subscription.household_id = current_household_id
    ) then
      raise exception using errcode = 'P0001', message = 'no_subscription_to_resubscribe';
    end if;
  end if;

  if exists (
    select 1 from public.household_billing_actions as action_row
    where action_row.household_id = current_household_id
      and action_row.action = p_action
      and action_row.status = 'pending'
  ) then
    raise exception using errcode = 'P0001', message = 'billing_action_pending';
  end if;

  insert into public.household_billing_actions(household_id, action, requested_by)
  values (current_household_id, p_action, current_user_id)
  returning id into created_action_id;

  action_id := created_action_id;
  action := p_action;
  status := 'pending';
  created_at := now();
  return next;
end
$$;

revoke all on function public.admin_request_billing_action(text) from public;
grant execute on function public.admin_request_billing_action(text) to authenticated;

-- Read-side subscription facts for the app. Membership is the boundary; billing
-- state stays server-authoritative and mirrors provider-synced seat counts.
create or replace function public.current_household_subscription()
returns table (
  household_id uuid,
  status text,
  provider text,
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  cancel_at_period_end boolean,
  canceled_at timestamptz,
  base_seat_allowance integer,
  add_on_seat_count integer,
  add_on_unit_amount_minor_units bigint,
  currency text,
  provider_event_id text,
  active_member_count bigint,
  billed_seat_count bigint,
  billing_enabled boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    membership.household_id,
    coalesce(subscription.status, 'none'),
    subscription.provider,
    subscription.provider_subscription_id,
    subscription.current_period_start,
    subscription.current_period_end,
    subscription.current_period_end + interval '7 days',
    coalesce(subscription.cancel_at_period_end, false),
    subscription.canceled_at,
    coalesce(subscription.base_seat_allowance, 5),
    coalesce(subscription.add_on_seat_count, 0),
    subscription.add_on_unit_amount_minor_units,
    subscription.currency,
    subscription.provider_event_id,
    (select count(*) from public.household_members as member_row where member_row.household_id = membership.household_id),
    greatest(0, (select count(*) from public.household_members as member_row where member_row.household_id = membership.household_id) - coalesce(subscription.base_seat_allowance, 5)),
    public.entitlement_enforcement_enabled()
  from public.household_members as membership
  left join public.household_subscriptions as subscription
    on subscription.household_id = membership.household_id
  where membership.user_id = auth.uid()
$$;

revoke all on function public.current_household_subscription() from public;
grant execute on function public.current_household_subscription() to authenticated;

-- Seat capacity now follows the effective allowance: five for trials and for
-- flagged-off enforcement, base plus provider-synced add-ons for paid periods.
create or replace function public.request_household_access(p_token text)
returns table (
  request_id uuid,
  household_name text,
  status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  invite_household_id uuid;
  invite_id uuid;
  invite_household_name text;
  current_request public.household_join_requests;
  current_membership public.household_members;
  active_member_count bigint;
  pending_request_count bigint;
  effective_seat_limit integer;
  next_expiry timestamptz;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if not exists (
    select 1 from auth.users
    where id = current_user_id and email_confirmed_at is not null
  ) then
    raise exception using errcode = '42501', message = 'email_confirmation_required';
  end if;

  select invite.household_id
  into invite_household_id
  from public.household_invites as invite
  where invite.token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
  limit 1;
  if invite_household_id is null then
    raise exception using errcode = '22023', message = 'invite_invalid_or_expired';
  end if;
  perform 1 from public.households where id = invite_household_id for update;

  select invite.id, invite.household_id, household.name
  into invite_id, invite_household_id, invite_household_name
  from public.household_invites as invite
  join public.households as household on household.id = invite.household_id
  where invite.token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
    and invite.revoked_at is null
    and invite.expires_at > now()
  limit 1;
  if invite_household_id is null then
    raise exception using errcode = '22023', message = 'invite_invalid_or_expired';
  end if;

  select * into current_membership
  from public.household_members
  where user_id = current_user_id;
  if current_membership.user_id is not null then
    if current_membership.household_id <> invite_household_id then
      raise exception using errcode = '23505', message = 'account_belongs_to_another_household';
    end if;
    request_id := null;
    household_name := invite_household_name;
    status := 'approved';
    expires_at := null;
    return next;
    return;
  end if;

  perform public.expire_household_join_requests(invite_household_id);

  select request.* into current_request
  from public.household_join_requests as request
  where request.household_id = invite_household_id
    and request.user_id = current_user_id
    and request.status = 'pending'
  for update;

  if current_request.id is not null then
    request_id := current_request.id;
    household_name := invite_household_name;
    status := current_request.status;
    expires_at := current_request.expires_at;
    return next;
    return;
  end if;

  select count(*) into active_member_count
  from public.household_members
  where household_id = invite_household_id;
  select count(*) into pending_request_count
  from public.household_join_requests as request
  where request.household_id = invite_household_id and request.status = 'pending';
  effective_seat_limit := public.household_effective_seat_limit(invite_household_id);
  if active_member_count + pending_request_count >= effective_seat_limit then
    raise exception using errcode = 'P0001', message = 'household_capacity_reached';
  end if;

  next_expiry := now() + interval '7 days';
  insert into public.household_join_requests(
    household_id, invite_id, user_id, status, expires_at
  ) values (
    invite_household_id, invite_id, current_user_id, 'pending', next_expiry
  ) returning id into request_id;
  household_name := invite_household_name;
  status := 'pending';
  expires_at := next_expiry;
  return next;
end
$$;

-- Approving beyond the base five seats requires a live paid subscription, an
-- exact provider-supplied add-on charge, and the admin's explicit confirmation.
-- The confirmed charge is recorded in a billing action for audit and for the
-- future provider integration. Pending requests never create charges.
drop function if exists public.approve_household_request(uuid);

create or replace function public.approve_household_request(
  p_request_id uuid,
  p_confirm_add_on_charge boolean default false
)
returns table (request_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  request_row public.household_join_requests;
  active_member_count bigint;
  effective_seat_limit integer;
  subscription_row public.household_subscriptions;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select request.* into request_row
  from public.household_join_requests as request
  where request.id = p_request_id;
  if request_row.id is null then
    raise exception using errcode = 'P0002', message = 'request_not_found';
  end if;
  perform 1 from public.households where id = request_row.household_id for update;
  if not exists (
    select 1 from public.household_members
    where household_id = request_row.household_id
      and user_id = current_user_id
      and role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;

  select * into request_row
  from public.household_join_requests
  where id = p_request_id
  for update;
  if request_row.status <> 'pending' then
    request_id := request_row.id;
    status := request_row.status;
    return next;
    return;
  end if;
  if request_row.expires_at <= now() then
    update public.household_join_requests
    set status = 'expired', handled_at = now()
    where id = request_row.id;
    request_id := request_row.id;
    status := 'expired';
    return next;
    return;
  end if;

  select count(*) into active_member_count
  from public.household_members
  where household_id = request_row.household_id;
  effective_seat_limit := public.household_effective_seat_limit(request_row.household_id);
  if active_member_count >= effective_seat_limit then
    raise exception using errcode = 'P0001', message = 'household_capacity_reached';
  end if;

  if public.entitlement_enforcement_enabled() then
    select * into subscription_row
    from public.household_subscriptions
    where household_id = request_row.household_id;
    -- The fixed base five is the authoritative allowance: add-on billing only
    -- applies beyond the stored base, never a hardcoded threshold.
    if active_member_count >= coalesce(subscription_row.base_seat_allowance, 5) then
      if subscription_row.household_id is null or now() >= subscription_row.current_period_end then
        raise exception using errcode = 'P0001', message = 'paid_subscription_required';
      end if;
      if subscription_row.add_on_unit_amount_minor_units is null or subscription_row.currency is null then
        raise exception using errcode = 'P0001', message = 'add_on_charge_not_configured';
      end if;
      if p_confirm_add_on_charge is distinct from true then
        raise exception using errcode = 'P0001', message = 'add_on_charge_confirmation_required';
      end if;
      insert into public.household_billing_actions(
        household_id, action, status, detail, requested_by
      ) values (
        request_row.household_id, 'add_on_seat', 'applied',
        jsonb_build_object(
          'request_id', request_row.id,
          'user_id', request_row.user_id,
          'add_on_unit_amount_minor_units', subscription_row.add_on_unit_amount_minor_units,
          'currency', subscription_row.currency
        ),
        current_user_id
      );
    end if;
  end if;

  begin
    insert into public.household_members(household_id, user_id, role)
    values (request_row.household_id, request_row.user_id, 'member');
  exception when unique_violation then
    if exists (
      select 1 from public.household_members
      where user_id = request_row.user_id and household_id <> request_row.household_id
    ) then
      raise exception using errcode = '23505', message = 'account_belongs_to_another_household';
    end if;
    raise;
  end;
  update public.household_join_requests
  set status = 'approved', handled_at = now()
  where id = request_row.id;
  request_id := request_row.id;
  status := 'approved';
  return next;
end
$$;

revoke all on function public.approve_household_request(uuid, boolean) from public;
grant execute on function public.approve_household_request(uuid, boolean) to authenticated;
