-- Household deletion is a reversible, server-authoritative lifecycle. A deleted
-- household keeps its row for 30 days so its former admin can recover it; all
-- non-admin access is removed immediately. Purging is deliberately separate.

alter table public.households
  add column if not exists deleted_at timestamptz,
  add column if not exists deletion_expires_at timestamptz;

create table public.deleted_households (
  household_id uuid primary key references public.households(id) on delete cascade,
  former_admin_id uuid not null references public.profiles(id) on delete restrict,
  deleted_at timestamptz not null default now(),
  purge_at timestamptz not null,
  household_name text not null,
  constraint deleted_households_purge_after_delete check (purge_at > deleted_at)
);

create index deleted_households_purge_idx on public.deleted_households(purge_at);

-- Purge cancellation intents must survive the household cascade. This table
-- deliberately has no household foreign key: a service-side provider worker
-- consumes the durable intent after the application rows are gone.
create table public.household_cancellation_outbox (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  provider text,
  provider_subscription_id text,
  reason text not null check (reason in ('immediate_purge', 'expiry_purge')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'applied', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint household_cancellation_outbox_provider_pair check (
    (provider is null) = (provider_subscription_id is null)
  )
);

create index household_cancellation_outbox_pending_idx
  on public.household_cancellation_outbox(status, created_at);
create unique index household_cancellation_outbox_one_reason
  on public.household_cancellation_outbox(household_id, reason);
create trigger household_cancellation_outbox_updated_at
before update on public.household_cancellation_outbox
for each row execute function public.set_updated_at();

alter table public.household_cancellation_outbox enable row level security;
revoke all on public.household_cancellation_outbox from anon, authenticated;

alter table public.deleted_households enable row level security;
revoke all on public.deleted_households from anon, authenticated;

-- Deleted households are not active members even though the former admin row
-- remains as the recovery anchor.
create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_household_id is not null
    and exists (
      select 1
      from public.household_members as membership
      join public.households as household on household.id = membership.household_id
      where membership.household_id = p_household_id
        and membership.user_id = auth.uid()
        and household.deleted_at is null
    )
$$;

drop policy if exists household_members_read_member on public.household_members;
create policy household_members_read_member
on public.household_members for select
 to authenticated
using (
  exists (
    select 1 from public.households as household
    where household.id = household_members.household_id and household.deleted_at is null
  )
  and (user_id = auth.uid() or public.is_household_member(household_id))
);

create or replace function public.current_household_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select membership.household_id
  from public.household_members as membership
  join public.households as household on household.id = membership.household_id
  where membership.user_id = auth.uid() and household.deleted_at is null
  limit 1
$$;

create or replace function public.require_household_membership()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare current_household uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select public.current_household_id() into current_household;
  if current_household is null then
    if exists (
      select 1 from public.deleted_households
      where former_admin_id = auth.uid() and purge_at > now()
    ) then
      raise exception using errcode = '42501', message = 'household_deleted';
    end if;
    raise exception using errcode = '42501', message = 'household_membership_required';
  end if;
  return current_household;
end
$$;

-- Household writes must remain possible in read-only billing states: deletion
-- is an account-lifecycle action, not a product or subscription mutation.
create or replace function public.enforce_household_entitlement_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare affected_household uuid;
begin
  if tg_op = 'UPDATE' and old.household_id is distinct from new.household_id then
    raise exception using errcode = 'P0001', message = 'household_id_change_not_allowed';
  end if;
  affected_household := case when tg_op = 'DELETE' then old.household_id else new.household_id end;
  if exists (
    select 1 from public.households
    where id = affected_household and deleted_at is not null
  ) then
    if tg_op = 'DELETE' then return old; end if;
    raise exception using errcode = '42501', message = 'household_deleted';
  end if;
  if not public.entitlement_enforcement_enabled() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name = 'household_join_requests' and tg_op = 'UPDATE' then
    if to_jsonb(old)->>'status' = 'pending'
       and to_jsonb(new)->>'status' = 'expired' then
      return new;
    end if;
  end if;
  if tg_table_name = 'household_members'
     and tg_op = 'INSERT'
     and (to_jsonb(new)->>'user_id')::uuid = auth.uid()
     and not exists (select 1 from public.household_members where household_id = new.household_id)
     and exists (select 1 from public.household_trials where household_id = new.household_id and now() < ends_at) then
    return new;
  end if;
  if tg_table_name = 'household_join_requests' then
    perform public.require_household_entitlement_state(affected_household);
  else
    perform public.require_household_mutation_access(affected_household);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

-- The former admin is the only person who can see recovery state. Returning no
-- row for everyone else prevents deleted-household metadata from becoming an
-- enumeration oracle.
create or replace function public.current_deleted_household()
returns table (
  household_id uuid,
  household_name text,
  deleted_at timestamptz,
  purge_at timestamptz,
  recoverable boolean
)
language sql stable security definer set search_path = ''
as $$
  select deleted.household_id, deleted.household_name, deleted.deleted_at,
         deleted.purge_at, deleted.purge_at > now()
  from public.deleted_households as deleted
  where deleted.former_admin_id = auth.uid()
    and deleted.purge_at > now()
  limit 1
$$;

create or replace function public.delete_household(p_purge_now boolean default false)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_household_id uuid;
  target_household_name text;
  subscription_provider text;
  provider_subscription_id text;
  deleted_at_value timestamptz := now();
  purge_at_value timestamptz := now() + interval '30 days';
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select membership.household_id, household.name
  into target_household_id, target_household_name
  from public.household_members as membership
  join public.households as household on household.id = membership.household_id
  where membership.user_id = current_user_id
    and membership.role = 'admin'
    and household.deleted_at is null;
  if target_household_id is null then
    if exists (select 1 from public.deleted_households where former_admin_id = current_user_id) then
      raise exception using errcode = 'P0001', message = 'household_already_deleted';
    end if;
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  perform 1 from public.households where id = target_household_id for update;

  if p_purge_now then
    -- Capture provider-owned cancellation coordinates before the household,
    -- subscription, and billing-action cascades. Nulls are intentional when
    -- this household has no provider subscription.
    select subscription.provider, subscription.provider_subscription_id
    into subscription_provider, provider_subscription_id
    from public.household_subscriptions as subscription
    where subscription.household_id = target_household_id;
    insert into public.household_cancellation_outbox(
      household_id, provider, provider_subscription_id, reason
    ) values (
      target_household_id, subscription_provider, provider_subscription_id, 'immediate_purge'
    );
    -- Mark first so cascading product/member deletes take the deleted-household
    -- cleanup path even when entitlement enforcement is enabled;
    update public.households
    set deleted_at = deleted_at_value, deletion_expires_at = deleted_at_value
    where public.households.id = target_household_id;
    -- account_trial_eligibility owns a nullable FK to households. Clear both
    -- ownership fields first, while retaining exposure and consumption.
    update public.account_trial_eligibility
    set owned_household_id = null, owned_trial_started_at = null
    where account_trial_eligibility.owned_household_id = target_household_id;
    -- Remove trigger-bearing children explicitly while the deleted marker is
    -- visible. This keeps the normal entitlement trigger enforcement intact;
    -- the lifecycle state, rather than a trigger bypass, authorizes cleanup.
    delete from public.products where household_id = target_household_id;
    delete from public.household_invites where household_id = target_household_id;
    delete from public.household_join_requests where household_id = target_household_id;
    delete from public.household_members where household_id = target_household_id;
    delete from public.households where id = target_household_id;
    return true;
  end if;

  update public.households
  set deleted_at = deleted_at_value, deletion_expires_at = purge_at_value
  where public.households.id = target_household_id;
  insert into public.deleted_households(
    household_id, former_admin_id, deleted_at, purge_at, household_name
  ) values (
    target_household_id, current_user_id, deleted_at_value, purge_at_value, target_household_name
  );
  -- Deletion revokes app access immediately, but subscription truth remains
  -- provider-owned. Record only a provider-neutral lifecycle intent; a
  -- service-side provider integration settles it after cancellation is
  -- confirmed, without inventing a provider or subscription identifier.
  update public.household_billing_actions
  set status = 'rejected'
  where household_billing_actions.household_id = target_household_id and status = 'pending';
  insert into public.household_billing_actions(
    household_id, action, status, detail, requested_by
  ) values (
    target_household_id, 'delete_household', 'pending',
    jsonb_build_object('purge_now', false), current_user_id
  );
  -- Deletion is stronger than revocation: remove stale links and requests so
  -- they cannot be replayed after recovery. The deleted-household trigger
  -- permits these cleanup deletes while ordinary writes remain gated.
  delete from public.household_invites
  where household_invites.household_id = target_household_id;
  delete from public.household_join_requests
  where household_join_requests.household_id = target_household_id;
  update public.household_member_intervals
  set ended_at = deleted_at_value
  where household_member_intervals.household_id = target_household_id
    and household_member_intervals.ended_at is null;
  -- Keep exactly the former admin recovery anchor. Former members become
  -- unassigned and may create or join another household.
  delete from public.household_members
  where household_members.household_id = target_household_id and user_id <> current_user_id;
  return true;
end
$$;

create or replace function public.recover_deleted_household()
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  deleted_row public.deleted_households;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select * into deleted_row
  from public.deleted_households
  where former_admin_id = auth.uid()
  for update;
  if deleted_row.household_id is null then
    raise exception using errcode = '42501', message = 'household_recovery_forbidden';
  end if;
  if deleted_row.purge_at <= now() then
    raise exception using errcode = 'P0001', message = 'household_recovery_expired';
  end if;
  perform 1 from public.households where id = deleted_row.household_id for update;
  update public.households
  set deleted_at = null, deletion_expires_at = null
  where id = deleted_row.household_id;
  update public.household_billing_actions
  set status = 'rejected'
  where household_id = deleted_row.household_id
    and action = 'delete_household'
    and status = 'pending';
  delete from public.deleted_households where household_id = deleted_row.household_id;
  insert into public.household_member_intervals(household_id, user_id, started_at)
  values (deleted_row.household_id, auth.uid(), now())
  on conflict (user_id) where ended_at is null do nothing;
  return true;
end
$$;

create or replace function public.purge_expired_deleted_households()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  target uuid;
  subscription_provider text;
  provider_subscription_id text;
  purged integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  for target in
    select household_id from public.deleted_households
    where purge_at <= now()
    order by purge_at, household_id
    for update skip locked
  loop
    -- Capture provider-owned cancellation coordinates before the household,
    -- subscription, and billing-action cascades. Nulls are intentional when
    -- this household has no provider subscription.
    select subscription.provider, subscription.provider_subscription_id
    into subscription_provider, provider_subscription_id
    from public.household_subscriptions as subscription
    where subscription.household_id = target;
    insert into public.household_cancellation_outbox(
      household_id, provider, provider_subscription_id, reason
    ) values (
      target, subscription_provider, provider_subscription_id, 'expiry_purge'
    );
    -- Keep lifetime consumption when the household cascade runs.
    update public.account_trial_eligibility
    set owned_household_id = null, owned_trial_started_at = null
    where owned_household_id = target;
    delete from public.households where id = target;
    purged := purged + 1;
  end loop;
  return purged;
end
$$;

revoke all on function public.current_deleted_household() from public;
revoke all on function public.delete_household(boolean) from public;
revoke all on function public.recover_deleted_household() from public;
revoke all on function public.purge_expired_deleted_households() from public;
grant execute on function public.current_deleted_household() to authenticated;
grant execute on function public.delete_household(boolean) to authenticated;
grant execute on function public.recover_deleted_household() to authenticated;
grant execute on function public.purge_expired_deleted_households() to service_role;

-- Existing creation and invite paths must not silently bypass recovery.
create or replace function public.preview_household_invite(p_token text)
returns table (household_name text, approval_required boolean)
language sql security definer set search_path = ''
as $$
  select h.name, true
  from public.household_invites as invite
  join public.households as h on h.id = invite.household_id
  where invite.token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
    and invite.revoked_at is null and invite.expires_at > now()
    and h.deleted_at is null
  limit 1
$$;

-- Recreate the creation function only to add the recoverable-admin guard; the
-- remaining creation contract is intentionally unchanged from ticket 08.
create or replace function public.create_household_with_trial()
returns table (household_id uuid, household_name text, trial_starts_at timestamptz, trial_ends_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  creator_name text;
  generated_name text;
  existing_household_id uuid;
  existing_household_role text;
  created_household_id uuid;
  created_trial_starts_at timestamptz;
  created_trial_ends_at timestamptz;
begin
  if current_user_id is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if not exists (select 1 from auth.users where id = current_user_id and email_confirmed_at is not null) then
    raise exception using errcode = '42501', message = 'email_confirmation_required';
  end if;
  if exists (select 1 from public.deleted_households where former_admin_id = current_user_id and purge_at > now()) then
    raise exception using errcode = 'P0001', message = 'deleted_household_recovery_required';
  end if;
  insert into public.account_trial_eligibility(user_id) values (current_user_id) on conflict (user_id) do nothing;
  perform public.sync_account_trial_eligibility(current_user_id);
  perform 1 from public.account_trial_eligibility where user_id = current_user_id for update;
  select hm.household_id, hm.role into existing_household_id, existing_household_role
  from public.household_members as hm join public.households as h on h.id = hm.household_id
  where hm.user_id = current_user_id and h.deleted_at is null;
  if existing_household_id is not null then
    if existing_household_role <> 'admin' then raise exception using errcode = '23505', message = 'household_membership_exists'; end if;
    select h.id, h.name, trial.starts_at, trial.ends_at into household_id, household_name, trial_starts_at, trial_ends_at
    from public.households as h left join public.household_trials as trial on trial.household_id = h.id
    where h.id = existing_household_id;
    return next; return;
  end if;
  select nullif(btrim(name), '') into creator_name from public.profiles where id = current_user_id;
  if creator_name is null then raise exception using errcode = 'P0002', message = 'profile_required'; end if;
  generated_name := left(creator_name, 80 - char_length('''s household')) || '''s household';
  created_trial_starts_at := now(); created_trial_ends_at := created_trial_starts_at + interval '14 days';
  insert into public.households(name) values (generated_name) returning id, name into created_household_id, household_name;
  perform public.claim_owned_household_trial(created_household_id, created_trial_starts_at);
  insert into public.household_trials(household_id, starts_at, ends_at) values (created_household_id, created_trial_starts_at, created_trial_ends_at);
  insert into public.household_members(household_id, user_id, role) values (created_household_id, current_user_id, 'admin');
  household_id := created_household_id; trial_starts_at := created_trial_starts_at; trial_ends_at := created_trial_ends_at;
  return next;
end
$$;
revoke all on function public.create_household_with_trial() from public;
grant execute on function public.create_household_with_trial() to authenticated;

-- The access RPC receives a deleted invite only through stale links. Keep the
-- error explicit and do not create a request.
create or replace function public.request_household_access(p_token text)
returns table (request_id uuid, household_name text, status text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid(); invite_household_id uuid; invite_id uuid;
  invite_household_name text; current_request public.household_join_requests;
  current_membership public.household_members; active_member_count bigint;
  pending_request_count bigint; effective_seat_limit integer; next_expiry timestamptz;
begin
  if current_user_id is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if not exists (select 1 from auth.users where id = current_user_id and email_confirmed_at is not null) then
    raise exception using errcode = '42501', message = 'email_confirmation_required';
  end if;
  select invite.household_id into invite_household_id from public.household_invites as invite
  where invite.token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256') limit 1;
  if invite_household_id is null then raise exception using errcode = '22023', message = 'invite_invalid_or_expired'; end if;
  perform 1 from public.households where id = invite_household_id for update;
  if exists (select 1 from public.households where id = invite_household_id and deleted_at is not null) then
    raise exception using errcode = '42501', message = 'household_deleted';
  end if;
  select invite.id, invite.household_id, household.name into invite_id, invite_household_id, invite_household_name
  from public.household_invites as invite join public.households as household on household.id = invite.household_id
  where invite.token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
    and invite.revoked_at is null and invite.expires_at > now() and household.deleted_at is null limit 1;
  if invite_household_id is null then raise exception using errcode = '22023', message = 'invite_invalid_or_expired'; end if;
  if exists (select 1 from public.deleted_households where former_admin_id = current_user_id and purge_at > now()) then
    raise exception using errcode = 'P0001', message = 'deleted_household_recovery_required';
  end if;
  select * into current_membership from public.household_members where user_id = current_user_id;
  if current_membership.user_id is not null then
    if current_membership.household_id <> invite_household_id then raise exception using errcode = '23505', message = 'account_belongs_to_another_household'; end if;
    request_id := null; household_name := invite_household_name; status := 'approved'; expires_at := null; return next; return;
  end if;
  perform public.expire_household_join_requests(invite_household_id);
  select request.* into current_request from public.household_join_requests as request
  where request.household_id = invite_household_id and request.user_id = current_user_id and request.status = 'pending' for update;
  if current_request.id is not null then request_id := current_request.id; household_name := invite_household_name; status := current_request.status; expires_at := current_request.expires_at; return next; return; end if;
  select count(*) into active_member_count from public.household_members where household_id = invite_household_id;
  select count(*) into pending_request_count
  from public.household_join_requests as request
  where request.household_id = invite_household_id and request.status = 'pending';
  effective_seat_limit := public.household_effective_seat_limit(invite_household_id);
  if active_member_count + pending_request_count >= effective_seat_limit then raise exception using errcode = 'P0001', message = 'household_capacity_reached'; end if;
  next_expiry := now() + interval '7 days';
  insert into public.household_join_requests(household_id, invite_id, user_id, status, expires_at) values (invite_household_id, invite_id, current_user_id, 'pending', next_expiry) returning id into request_id;
  household_name := invite_household_name; status := 'pending'; expires_at := next_expiry; return next;
end
$$;
revoke all on function public.request_household_access(text) from public;
grant execute on function public.request_household_access(text) to authenticated;

-- Deleted households have an explicit access state rather than accidentally
-- looking like an active membership to server-side entitlement callers.
create or replace function public.household_entitlement_for(p_household_id uuid)
returns table (
  household_id uuid, access_state text, trial_starts_at timestamptz,
  trial_ends_at timestamptz, grace_ends_at timestamptz, seat_limit integer,
  enforcement_enabled boolean, can_mutate boolean, reads_available boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  trial_row public.household_trials;
  plan_name text;
  enforcement boolean := public.entitlement_enforcement_enabled();
  subscription_row public.household_subscriptions;
begin
  if exists (
    select 1 from public.deleted_households
    where deleted_households.household_id = p_household_id
      and deleted_households.former_admin_id = auth.uid()
  ) then
    household_id := p_household_id;
    access_state := 'deleted';
    enforcement_enabled := enforcement;
    can_mutate := false;
    reads_available := false;
    return next;
    return;
  end if;
  if not exists (
    select 1 from public.household_members
    where household_members.household_id = p_household_id
      and household_members.user_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'household_membership_required';
  end if;
  select * into trial_row from public.household_trials where household_trials.household_id = p_household_id;
  select entitlement.entitlement_plan into plan_name from public.household_entitlements as entitlement where entitlement.household_id = p_household_id;
  select * into subscription_row from public.household_subscriptions as subscription where subscription.household_id = p_household_id;
  household_id := p_household_id;
  trial_starts_at := trial_row.starts_at;
  trial_ends_at := trial_row.ends_at;
  grace_ends_at := coalesce(subscription_row.current_period_end, trial_row.ends_at) + interval '7 days';
  seat_limit := coalesce(subscription_row.base_seat_allowance + subscription_row.add_on_seat_count,
    (select entitlement.seat_limit from public.household_entitlements as entitlement where entitlement.household_id = p_household_id), 5);
  enforcement_enabled := enforcement;
  reads_available := true;
  if plan_name = 'paid_placeholder' then access_state := 'paid_placeholder';
  elsif subscription_row.household_id is not null and now() < subscription_row.current_period_end
    and subscription_row.status in ('trialing', 'active') then access_state := 'paid_active';
  elsif subscription_row.household_id is not null and now() < subscription_row.current_period_end + interval '7 days' then access_state := 'read_only_grace';
  elsif subscription_row.household_id is not null then access_state := 'unavailable_locked';
  elsif now() < trial_row.ends_at then access_state := 'active_trial';
  elsif now() < trial_row.ends_at + interval '7 days' then access_state := 'read_only_grace';
  else access_state := 'unavailable_locked'; end if;
  can_mutate := not enforcement or access_state in ('active_trial', 'paid_placeholder', 'paid_active');
  return next;
end
$$;
revoke all on function public.household_entitlement_for(uuid) from public;

-- The recovery anchor is not an active billing reader while deleted.
drop policy if exists household_billing_actions_read_admin on public.household_billing_actions;
create policy household_billing_actions_read_admin
on public.household_billing_actions for select
to authenticated
using (
  exists (
    select 1
    from public.household_members as membership
    join public.households as household on household.id = membership.household_id
    where membership.household_id = household_billing_actions.household_id
      and membership.user_id = auth.uid()
      and membership.role = 'admin'
      and household.deleted_at is null
  )
);

-- Active-household guards: deletion keeps only a recovery anchor membership,
-- which must not authorize ordinary admin, member-management, or billing RPCs.
create or replace function public.invite_household_member()
returns table (invite_token text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_household_id uuid;
  raw_token text;
  invite_expiry timestamptz;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select membership.household_id into current_household_id
  from public.household_members as membership
  join public.households as household on household.id = membership.household_id
  where membership.user_id = current_user_id
    and membership.role = 'admin'
    and household.deleted_at is null;
  if current_household_id is null then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  perform 1 from public.households where id = current_household_id for update;
  update public.household_invites
  set revoked_at = now()
  where household_id = current_household_id and revoked_at is null;
  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  invite_expiry := now() + interval '12 hours';
  insert into public.household_invites(household_id, token_hash, expires_at, created_by)
  values (current_household_id, extensions.digest(convert_to(raw_token, 'UTF8'), 'sha256'), invite_expiry, current_user_id);
  invite_token := raw_token;
  expires_at := invite_expiry;
  return next;
end
$$;

create or replace function public.list_household_members(p_household_id uuid)
returns table (user_id uuid, name text, email text, role text, created_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  perform 1 from public.households where id = p_household_id for update;
  if not exists (
    select 1 from public.household_members as membership
    join public.households as household on household.id = membership.household_id
    where membership.household_id = p_household_id
      and membership.user_id = current_user_id
      and membership.role = 'admin'
      and household.deleted_at is null
  ) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  return query
  select membership.user_id, profile.name, profile.email, membership.role, membership.created_at
  from public.household_members as membership
  join public.profiles as profile on profile.id = membership.user_id
  where membership.household_id = p_household_id
  order by membership.created_at, membership.user_id;
end
$$;

create or replace function public.remove_household_member(p_household_id uuid, p_user_id uuid)
returns table (user_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  perform 1 from public.households where id = p_household_id for update;
  if not exists (
    select 1 from public.household_members as membership
    join public.households as household on household.id = membership.household_id
    where membership.household_id = p_household_id
      and membership.user_id = current_user_id
      and membership.role = 'admin'
      and household.deleted_at is null
  ) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  if p_user_id = current_user_id then
    raise exception using errcode = 'P0001', message = 'member_self_removal';
  end if;
  delete from public.household_members as membership
  where membership.household_id = p_household_id
    and membership.user_id = p_user_id
    and membership.role = 'member';
  if not found then
    raise exception using errcode = 'P0002', message = 'household_member_not_found';
  end if;
  update public.household_invites set revoked_at = now()
  where household_id = p_household_id and revoked_at is null;
  user_id := p_user_id;
  return next;
end
$$;

create or replace function public.list_pending_household_requests(p_household_id uuid)
returns table (request_id uuid, name text, email text, requested_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if not exists (
    select 1 from public.household_members as membership
    join public.households as household on household.id = membership.household_id
    where membership.household_id = p_household_id
      and membership.user_id = current_user_id
      and membership.role = 'admin'
      and household.deleted_at is null
  ) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  perform 1 from public.households where id = p_household_id for update;
  perform public.expire_household_join_requests(p_household_id);
  return query
  select request.id, profile.name, profile.email, request.created_at, request.expires_at
  from public.household_join_requests as request
  join public.profiles as profile on profile.id = request.user_id
  where request.household_id = p_household_id and request.status = 'pending'
  order by request.created_at asc, request.id asc;
end
$$;

create or replace function public.approve_household_request(p_request_id uuid, p_confirm_add_on_charge boolean default false)
returns table (request_id uuid, status text)
language plpgsql security definer set search_path = ''
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
  select request.* into request_row from public.household_join_requests as request where request.id = p_request_id;
  if request_row.id is null then
    raise exception using errcode = 'P0002', message = 'request_not_found';
  end if;
  perform 1 from public.households where id = request_row.household_id for update;
  if not exists (
    select 1 from public.household_members as membership
    join public.households as household on household.id = membership.household_id
    where membership.household_id = request_row.household_id
      and membership.user_id = current_user_id
      and membership.role = 'admin'
      and household.deleted_at is null
  ) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  select * into request_row from public.household_join_requests where id = p_request_id for update;
  if request_row.status <> 'pending' then
    request_id := request_row.id; status := request_row.status; return next; return;
  end if;
  if request_row.expires_at <= now() then
    update public.household_join_requests set status = 'expired', handled_at = now() where id = request_row.id;
    request_id := request_row.id; status := 'expired'; return next; return;
  end if;
  select count(*) into active_member_count from public.household_members where household_id = request_row.household_id;
  effective_seat_limit := public.household_effective_seat_limit(request_row.household_id);
  if active_member_count >= effective_seat_limit then
    raise exception using errcode = 'P0001', message = 'household_capacity_reached';
  end if;
  if public.entitlement_enforcement_enabled() then
    select * into subscription_row from public.household_subscriptions where household_id = request_row.household_id;
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
      insert into public.household_billing_actions(household_id, action, status, detail, requested_by)
      values (request_row.household_id, 'add_on_seat', 'applied',
        jsonb_build_object('request_id', request_row.id, 'user_id', request_row.user_id,
          'add_on_unit_amount_minor_units', subscription_row.add_on_unit_amount_minor_units,
          'currency', subscription_row.currency), current_user_id);
    end if;
  end if;
  begin
    insert into public.household_members(household_id, user_id, role)
    values (request_row.household_id, request_row.user_id, 'member');
  exception when unique_violation then
    if exists (select 1 from public.household_members where user_id = request_row.user_id and household_id <> request_row.household_id) then
      raise exception using errcode = '23505', message = 'account_belongs_to_another_household';
    end if;
    raise;
  end;
  update public.household_join_requests set status = 'approved', handled_at = now() where id = request_row.id;
  request_id := request_row.id; status := 'approved'; return next;
end
$$;

create or replace function public.reject_household_request(p_request_id uuid)
returns table (request_id uuid, status text)
language plpgsql security definer set search_path = ''
as $$
declare current_user_id uuid := auth.uid(); request_row public.household_join_requests;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select * into request_row from public.household_join_requests where id = p_request_id;
  if request_row.id is null then
    raise exception using errcode = 'P0002', message = 'request_not_found';
  end if;
  perform 1 from public.households where id = request_row.household_id for update;
  if not exists (
    select 1 from public.household_members as membership
    join public.households as household on household.id = membership.household_id
    where membership.household_id = request_row.household_id
      and membership.user_id = current_user_id
      and membership.role = 'admin'
      and household.deleted_at is null
  ) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  select * into request_row from public.household_join_requests where id = p_request_id for update;
  if request_row.status = 'pending' then
    update public.household_join_requests set status = 'rejected', handled_at = now() where id = request_row.id;
    request_row.status := 'rejected';
  end if;
  request_id := request_row.id; status := request_row.status; return next;
end
$$;

create or replace function public.reset_household(p_clear_products boolean, p_remove_members boolean)
returns table (products_deleted bigint, members_removed bigint)
language plpgsql security definer set search_path = ''
as $$
declare current_user_id uuid := auth.uid(); current_household_id uuid;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_clear_products is distinct from true and p_remove_members is distinct from true then
    raise exception using errcode = 'P0001', message = 'reset_choice_required';
  end if;
  select membership.household_id into current_household_id
  from public.household_members as membership
  join public.households as household on household.id = membership.household_id
  where membership.user_id = current_user_id and membership.role = 'admin' and household.deleted_at is null;
  if current_household_id is null then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  perform public.require_household_mutation_access(current_household_id);
  perform 1 from public.households where id = current_household_id for update;
  if p_clear_products then
    delete from public.products where household_id = current_household_id;
    get diagnostics products_deleted = row_count;
  else products_deleted := 0;
  end if;
  if p_remove_members then
    delete from public.household_join_requests where household_id = current_household_id;
    update public.household_invites set revoked_at = now() where household_id = current_household_id and revoked_at is null;
    delete from public.household_members where household_id = current_household_id and user_id <> current_user_id;
    get diagnostics members_removed = row_count;
  else members_removed := 0;
  end if;
  return next;
end
$$;

create or replace function public.admin_request_billing_action(p_action text)
returns table (action_id uuid, action text, status text, created_at timestamptz)
language plpgsql security definer set search_path = ''
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
  select membership.household_id into current_household_id
  from public.household_members as membership
  join public.households as household on household.id = membership.household_id
  where membership.user_id = current_user_id and membership.role = 'admin' and household.deleted_at is null;
  if current_household_id is null then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  if not public.entitlement_enforcement_enabled() then
    raise exception using errcode = 'P0001', message = 'billing_disabled';
  end if;
  perform 1 from public.households where id = current_household_id for update;
  if p_action = 'cancel_at_period_end' and not exists (
    select 1 from public.household_subscriptions as subscription
    where subscription.household_id = current_household_id and subscription.status in ('trialing', 'active')
      and subscription.cancel_at_period_end = false and now() < subscription.current_period_end
  ) then
    raise exception using errcode = 'P0001', message = 'no_active_subscription';
  elsif p_action = 'subscribe' and exists (
    select 1 from public.household_subscriptions as subscription
    where subscription.household_id = current_household_id and subscription.status in ('trialing', 'active', 'past_due')
      and now() < subscription.current_period_end
  ) then
    raise exception using errcode = 'P0001', message = 'subscription_already_active';
  elsif p_action = 'resubscribe' and not exists (
    select 1 from public.household_subscriptions as subscription where subscription.household_id = current_household_id
  ) then
    raise exception using errcode = 'P0001', message = 'no_subscription_to_resubscribe';
  end if;
  if exists (
    select 1 from public.household_billing_actions as action_row
    where action_row.household_id = current_household_id and action_row.action = p_action and action_row.status = 'pending'
  ) then
    raise exception using errcode = 'P0001', message = 'billing_action_pending';
  end if;
  insert into public.household_billing_actions(household_id, action, requested_by)
  values (current_household_id, p_action, current_user_id) returning id into created_action_id;
  action_id := created_action_id; action := p_action; status := 'pending'; created_at := now(); return next;
end
$$;

create or replace function public.current_household_subscription()
returns table (
  household_id uuid, status text, provider text, provider_subscription_id text,
  current_period_start timestamptz, current_period_end timestamptz, grace_ends_at timestamptz,
  cancel_at_period_end boolean, canceled_at timestamptz, base_seat_allowance integer,
  add_on_seat_count integer, add_on_unit_amount_minor_units bigint, currency text,
  provider_event_id text, active_member_count bigint, billed_seat_count bigint, billing_enabled boolean
)
language sql stable security definer set search_path = ''
as $$
  select membership.household_id, coalesce(subscription.status, 'none'), subscription.provider,
    subscription.provider_subscription_id, subscription.current_period_start, subscription.current_period_end,
    subscription.current_period_end + interval '7 days', coalesce(subscription.cancel_at_period_end, false),
    subscription.canceled_at, coalesce(subscription.base_seat_allowance, 5), coalesce(subscription.add_on_seat_count, 0),
    subscription.add_on_unit_amount_minor_units, subscription.currency, subscription.provider_event_id,
    (select count(*) from public.household_members as member_row where member_row.household_id = membership.household_id),
    greatest(0, (select count(*) from public.household_members as member_row where member_row.household_id = membership.household_id)
      - coalesce(subscription.base_seat_allowance, 5)), public.entitlement_enforcement_enabled()
  from public.household_members as membership
  join public.households as household on household.id = membership.household_id and household.deleted_at is null
  left join public.household_subscriptions as subscription on subscription.household_id = membership.household_id
  where membership.user_id = auth.uid()
$$;

revoke all on function public.invite_household_member() from public;
revoke all on function public.list_household_members(uuid) from public;
revoke all on function public.remove_household_member(uuid, uuid) from public;
revoke all on function public.list_pending_household_requests(uuid) from public;
revoke all on function public.approve_household_request(uuid, boolean) from public;
revoke all on function public.reject_household_request(uuid) from public;
revoke all on function public.reset_household(boolean, boolean) from public;
revoke all on function public.admin_request_billing_action(text) from public;
revoke all on function public.current_household_subscription() from public;
grant execute on function public.invite_household_member() to authenticated;
grant execute on function public.list_household_members(uuid) to authenticated;
grant execute on function public.remove_household_member(uuid, uuid) to authenticated;
grant execute on function public.list_pending_household_requests(uuid) to authenticated;
grant execute on function public.approve_household_request(uuid, boolean) to authenticated;
grant execute on function public.reject_household_request(uuid) to authenticated;
grant execute on function public.reset_household(boolean, boolean) to authenticated;
grant execute on function public.admin_request_billing_action(text) to authenticated;
grant execute on function public.current_household_subscription() to authenticated;
