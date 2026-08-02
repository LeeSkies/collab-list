-- Household entitlement state is deliberately server-side and defaults to the
-- legacy, fully editable behavior. Payment collection is out of scope here.
create table public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger feature_flags_updated_at
before update on public.feature_flags
for each row execute function public.set_updated_at();

insert into public.feature_flags(key, enabled)
values ('household_entitlement_enforcement', false)
on conflict (key) do nothing;

create table public.household_entitlements (
  household_id uuid primary key references public.households(id) on delete cascade,
  entitlement_plan text not null default 'trial'
    check (entitlement_plan in ('trial', 'paid_placeholder')),
  seat_limit integer not null default 5 check (seat_limit = 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger household_entitlements_updated_at
before update on public.household_entitlements
for each row execute function public.set_updated_at();

create table public.account_trial_eligibility (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  owned_household_id uuid references public.households(id) on delete set null,
  owned_trial_started_at timestamptz,
  exposure_days integer not null default 0 check (exposure_days >= 0),
  eligibility_consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_trial_owned_dates check (
    (owned_household_id is null and owned_trial_started_at is null)
    or (owned_household_id is not null and owned_trial_started_at is not null)
  )
);

create unique index account_trial_one_owned_household
  on public.account_trial_eligibility(owned_household_id)
  where owned_household_id is not null;

create trigger account_trial_eligibility_updated_at
before update on public.account_trial_eligibility
for each row execute function public.set_updated_at();

create table public.household_member_intervals (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint household_member_intervals_dates check (ended_at is null or ended_at >= started_at)
);

create unique index household_member_intervals_one_active
  on public.household_member_intervals(user_id)
  where ended_at is null;
create index household_member_intervals_user_idx
  on public.household_member_intervals(user_id, started_at, ended_at);

-- Existing rows are kept authoritative. A household that predates this
-- migration receives a trial anchored to its original creation timestamp.
insert into public.household_trials(household_id, starts_at, ends_at)
select household.id, household.created_at, household.created_at + interval '14 days'
from public.households as household
where not exists (
  select 1 from public.household_trials as trial
  where trial.household_id = household.id
);

insert into public.household_entitlements(household_id)
select household.id from public.households as household
on conflict (household_id) do nothing;

insert into public.account_trial_eligibility(user_id)
select profile.id from public.profiles as profile
on conflict (user_id) do nothing;

-- The first existing admin is an owner of the migrated household. This also
-- makes the local seeded admin in an already-populated deployment ineligible
-- for a second lifetime trial.
with first_owned as (
  select membership.user_id, membership.household_id, trial.starts_at
  from public.household_members as membership
  join public.household_trials as trial on trial.household_id = membership.household_id
  where membership.role = 'admin'
  order by membership.created_at, membership.household_id
  limit 1
)
update public.account_trial_eligibility as eligibility
set owned_household_id = first_owned.household_id,
    owned_trial_started_at = first_owned.starts_at,
    eligibility_consumed_at = coalesce(eligibility.eligibility_consumed_at, now())
from first_owned
where eligibility.user_id = first_owned.user_id
  and eligibility.owned_household_id is null;

-- Only verified memberships count toward exposure. Memberships are the
-- approved-access boundary; pending requests have no interval row.
insert into public.household_member_intervals(household_id, user_id, started_at)
select membership.household_id, membership.user_id, membership.created_at
from public.household_members as membership
join auth.users as account on account.id = membership.user_id
where account.email_confirmed_at is not null
  and not exists (
    select 1
    from public.household_member_intervals as interval_row
    where interval_row.user_id = membership.user_id
      and interval_row.ended_at is null
  );

alter table public.feature_flags enable row level security;
alter table public.household_entitlements enable row level security;
alter table public.account_trial_eligibility enable row level security;
alter table public.household_member_intervals enable row level security;

revoke all on public.feature_flags from anon, authenticated;
revoke all on public.household_entitlements from anon, authenticated;
revoke all on public.account_trial_eligibility from anon, authenticated;
revoke all on public.household_member_intervals from anon, authenticated;

drop policy if exists account_trial_eligibility_read_self on public.account_trial_eligibility;
create policy account_trial_eligibility_read_self
on public.account_trial_eligibility for select
 to authenticated
using (user_id = auth.uid());

drop policy if exists household_member_intervals_read_member on public.household_member_intervals;
create policy household_member_intervals_read_member
on public.household_member_intervals for select
 to authenticated
using (user_id = auth.uid() or public.is_household_member(household_id));

grant select on public.account_trial_eligibility to authenticated;
grant select on public.household_member_intervals to authenticated;

create or replace function public.entitlement_enforcement_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select flag.enabled
    from public.feature_flags as flag
    where flag.key = 'household_entitlement_enforcement'
  ), false)
$$;

create or replace function public.sync_account_trial_eligibility(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  eligibility_row public.account_trial_eligibility;
  active_exposure integer;
  total_exposure integer;
begin
  insert into public.account_trial_eligibility(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into eligibility_row
  from public.account_trial_eligibility
  where user_id = p_user_id
  for update;

  select coalesce(sum(greatest(0, (coalesce(interval_row.ended_at, now())::date - interval_row.started_at::date))), 0)::integer
  into active_exposure
  from public.household_member_intervals as interval_row
  where interval_row.user_id = p_user_id;

  total_exposure := greatest(eligibility_row.exposure_days, active_exposure);
  if total_exposure >= 7 and eligibility_row.eligibility_consumed_at is null then
    update public.account_trial_eligibility
    set exposure_days = total_exposure,
        eligibility_consumed_at = now()
    where user_id = p_user_id;
  elsif total_exposure <> eligibility_row.exposure_days then
    update public.account_trial_eligibility
    set exposure_days = total_exposure
    where user_id = p_user_id;
  end if;
end
$$;

create or replace function public.ensure_account_trial_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.account_trial_eligibility(user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end
$$;

create trigger account_trial_eligibility_created
after insert on public.profiles
for each row execute function public.ensure_account_trial_eligibility();

create or replace function public.record_household_membership_interval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.account_trial_eligibility(user_id)
  values (new.user_id)
  on conflict (user_id) do nothing;

  if exists (
    select 1 from auth.users as account
    where account.id = new.user_id and account.email_confirmed_at is not null
  ) then
    insert into public.household_member_intervals(household_id, user_id, started_at)
    values (new.household_id, new.user_id, new.created_at)
    on conflict (user_id) where ended_at is null do nothing;
  end if;
  return new;
end
$$;

create or replace function public.close_household_membership_interval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  interval_row public.household_member_intervals;
  exposure_delta integer;
begin
  select * into interval_row
  from public.household_member_intervals
  where user_id = old.user_id and ended_at is null
  order by started_at desc, id desc
  limit 1
  for update;

  if interval_row.id is null then
    return old;
  end if;

  exposure_delta := greatest(0, (now()::date - interval_row.started_at::date));
  update public.household_member_intervals
  set ended_at = now()
  where id = interval_row.id;

  insert into public.account_trial_eligibility(user_id)
  values (old.user_id)
  on conflict (user_id) do nothing;
  update public.account_trial_eligibility
  set exposure_days = exposure_days + exposure_delta,
      eligibility_consumed_at = case
        when exposure_days + exposure_delta >= 7 then coalesce(eligibility_consumed_at, now())
        else eligibility_consumed_at
      end
  where user_id = old.user_id;
  return old;
end
$$;

create trigger household_membership_interval_added
after insert on public.household_members
for each row execute function public.record_household_membership_interval();
create trigger household_membership_interval_closed
after delete on public.household_members
for each row execute function public.close_household_membership_interval();

-- Membership approval can happen before the invitee verifies their email. Keep
-- that approved row readable, but start exposure only at confirmation time.
create or replace function public.start_household_membership_interval_on_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    insert into public.account_trial_eligibility(user_id)
    values (new.id)
    on conflict (user_id) do nothing;

    insert into public.household_member_intervals(household_id, user_id, started_at)
    select membership.household_id, membership.user_id, new.email_confirmed_at
    from public.household_members as membership
    where membership.user_id = new.id
    on conflict (user_id) where ended_at is null do nothing;
  end if;
  return new;
end
$$;

create trigger auth_user_email_confirmation_interval
 after update of email_confirmed_at on auth.users
 for each row
 when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
 execute function public.start_household_membership_interval_on_confirmation();

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

  household_id := p_household_id;
  trial_starts_at := trial_row.starts_at;
  trial_ends_at := trial_row.ends_at;
  grace_ends_at := trial_row.ends_at + interval '7 days';
  seat_limit := coalesce((select entitlement.seat_limit from public.household_entitlements as entitlement where entitlement.household_id = p_household_id), 5);
  enforcement_enabled := enforcement;
  reads_available := true;
  if plan_name = 'paid_placeholder' then
    access_state := 'paid_placeholder';
  elsif now() < trial_row.ends_at then
    access_state := 'active_trial';
  elsif now() < trial_row.ends_at + interval '7 days' then
    access_state := 'read_only_grace';
  else
    access_state := 'unavailable_locked';
  end if;
  can_mutate := not enforcement or access_state in ('active_trial', 'paid_placeholder');
  return next;
end
$$;

create or replace function public.current_household_entitlement()
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
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.household_entitlement_for(public.require_household_membership())
$$;

create or replace function public.require_household_mutation_access(p_household_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  entitlement_row record;
begin
  if not public.entitlement_enforcement_enabled() then
    return p_household_id;
  end if;

  select * into entitlement_row
  from public.household_entitlement_for(p_household_id);
  if entitlement_row.household_id is null then
    raise exception using errcode = '42501', message = 'household_membership_required';
  end if;
  if entitlement_row.access_state = 'read_only_grace' then
    raise exception using errcode = '42501', message = 'household_read_only';
  end if;
  if entitlement_row.access_state = 'unavailable_locked' then
    raise exception using errcode = '42501', message = 'household_entitlement_locked';
  end if;
  return p_household_id;
end
$$;

-- Join requests are written by an unassigned requester. Their invite is the
-- authorization boundary, so this trigger-only helper evaluates state without
-- requiring household membership.
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
  if plan_name = 'paid_placeholder' or (trial_ends is not null and now() < trial_ends) then
    return p_household_id;
  end if;
  if trial_ends is not null and now() < trial_ends + interval '7 days' then
    raise exception using errcode = '42501', message = 'household_read_only';
  end if;
  raise exception using errcode = '42501', message = 'household_entitlement_locked';
end
$$;

revoke all on function public.entitlement_enforcement_enabled() from public;
revoke all on function public.sync_account_trial_eligibility(uuid) from public;
revoke all on function public.household_entitlement_for(uuid) from public;
revoke all on function public.current_household_entitlement() from public;
revoke all on function public.require_household_mutation_access(uuid) from public;
revoke all on function public.require_household_entitlement_state(uuid) from public;
grant execute on function public.entitlement_enforcement_enabled() to authenticated;
grant execute on function public.current_household_entitlement() to authenticated;

-- Keep direct SQL paths behind the same helper as the RPCs. Expiration is a
-- read-side cleanup and remains allowed so reads do not become stale.
create or replace function public.enforce_household_entitlement_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_household uuid;
begin
  -- Moving a row across households would require checking two entitlement
  -- states. Reject it instead so every UPDATE has one unambiguous boundary.
  if tg_op = 'UPDATE' and old.household_id is distinct from new.household_id then
    raise exception using errcode = 'P0001', message = 'household_id_change_not_allowed';
  end if;

  if not public.entitlement_enforcement_enabled() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name = 'household_join_requests' then
    if tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'expired' then
      return new;
    end if;
  end if;
  -- Household creation inserts its first admin before that membership exists,
  -- so allow only that authenticated creator while its newly-created trial is
  -- active. Approval still runs through the normal member check below.
  if tg_table_name = 'household_members' then
    if tg_op = 'INSERT'
       and (to_jsonb(new)->>'user_id')::uuid = auth.uid()
       and not exists (
         select 1 from public.household_members as membership
         where membership.household_id = new.household_id
       )
       and exists (
         select 1 from public.household_trials as trial
         where trial.household_id = new.household_id and now() < trial.ends_at
       ) then
      return new;
    end if;
  end if;
  if tg_op = 'DELETE' then
    affected_household := old.household_id;
  else
    affected_household := new.household_id;
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

create trigger products_entitlement_write
before insert or update or delete on public.products
for each row execute function public.enforce_household_entitlement_write();
create trigger household_invites_entitlement_write
before insert or update or delete on public.household_invites
for each row execute function public.enforce_household_entitlement_write();
create trigger household_join_requests_entitlement_write
before insert or update or delete on public.household_join_requests
for each row execute function public.enforce_household_entitlement_write();
create trigger household_members_entitlement_write
before insert or update or delete on public.household_members
for each row execute function public.enforce_household_entitlement_write();

-- Claiming is serialized on the account row, so concurrent create retries can
-- create at most one owned household.
create or replace function public.claim_owned_household_trial(
  p_household_id uuid,
  p_starts_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := public.require_authenticated();
  eligibility_row public.account_trial_eligibility;
begin
  insert into public.account_trial_eligibility(user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;
  perform public.sync_account_trial_eligibility(current_user_id);
  select * into eligibility_row
  from public.account_trial_eligibility
  where user_id = current_user_id
  for update;

  if eligibility_row.owned_household_id is not null
     or eligibility_row.eligibility_consumed_at is not null
     or eligibility_row.exposure_days >= 7 then
    raise exception using errcode = 'P0001', message = 'trial_eligibility_consumed';
  end if;
  update public.account_trial_eligibility
  set owned_household_id = p_household_id,
      owned_trial_started_at = p_starts_at,
      eligibility_consumed_at = p_starts_at
  where user_id = current_user_id;
end
$$;

revoke all on function public.claim_owned_household_trial(uuid, timestamptz) from public;

-- The household trigger supplies the fixed allowance for every future billing
-- integration, including households created by older clients.
create or replace function public.create_household_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.household_entitlements(household_id)
  values (new.id)
  on conflict (household_id) do nothing;
  return new;
end
$$;
create trigger household_entitlement_created
after insert on public.households
for each row execute function public.create_household_entitlement();

-- Household creation keeps its original return shape and dates while claiming
-- the account's one lifetime owned trial.
create or replace function public.create_household_with_trial()
returns table (
  household_id uuid,
  household_name text,
  trial_starts_at timestamptz,
  trial_ends_at timestamptz
)
language plpgsql
security definer
set search_path = ''
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
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if not exists (
    select 1 from auth.users
    where id = current_user_id and email_confirmed_at is not null
  ) then
    raise exception using errcode = '42501', message = 'email_confirmation_required';
  end if;

  -- Serialize eligibility before looking at membership so concurrent retries
  -- have one authoritative order.
  insert into public.account_trial_eligibility(user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;
  perform public.sync_account_trial_eligibility(current_user_id);
  perform 1 from public.account_trial_eligibility where user_id = current_user_id for update;

  select hm.household_id, hm.role
  into existing_household_id, existing_household_role
  from public.household_members as hm
  where hm.user_id = current_user_id;

  if existing_household_id is not null then
    if existing_household_role <> 'admin' then
      raise exception using errcode = '23505', message = 'household_membership_exists';
    end if;
    select h.id, h.name, trial.starts_at, trial.ends_at
    into household_id, household_name, trial_starts_at, trial_ends_at
    from public.households as h
    left join public.household_trials as trial on trial.household_id = h.id
    where h.id = existing_household_id;
    if not found then
      raise exception using errcode = '23505', message = 'household_membership_exists';
    end if;
    if trial_starts_at is null then
      select eligibility.owned_trial_started_at
      into trial_starts_at
      from public.account_trial_eligibility as eligibility
      where eligibility.user_id = current_user_id;
      trial_ends_at := trial_starts_at + interval '14 days';
    end if;
    return next;
    return;
  end if;

  select nullif(btrim(name), '') into creator_name
  from public.profiles where id = current_user_id;
  if creator_name is null then
    raise exception using errcode = 'P0002', message = 'profile_required';
  end if;

  generated_name := left(creator_name, 80 - char_length('''s household')) || '''s household';
  created_trial_starts_at := now();
  created_trial_ends_at := created_trial_starts_at + interval '14 days';

  insert into public.households(name)
  values (generated_name)
  returning id, name into created_household_id, household_name;
  perform public.claim_owned_household_trial(created_household_id, created_trial_starts_at);
  insert into public.household_trials(household_id, starts_at, ends_at)
  values (created_household_id, created_trial_starts_at, created_trial_ends_at);
  insert into public.household_members(household_id, user_id, role)
  values (created_household_id, current_user_id, 'admin');

  household_id := created_household_id;
  trial_starts_at := created_trial_starts_at;
  trial_ends_at := created_trial_ends_at;
  return next;
end
$$;

revoke all on function public.create_household_with_trial() from public;
grant execute on function public.create_household_with_trial() to authenticated;

-- Product RPCs call the helper explicitly; triggers above remain a defense in
-- depth for future RPCs and direct server-side paths.
create or replace function public.create_product(p_name text)
returns setof public.products
language plpgsql security definer set search_path = '' as $$
declare current_household uuid := public.require_household_membership();
begin
  perform public.require_household_mutation_access(current_household);
  return query insert into public.products(household_id, name, name_signature, created_by)
  values (current_household, p_name, public.product_name_signature(p_name), auth.uid()) returning *;
end $$;

create or replace function public.adjust_product_quantity(p_product_id uuid, p_delta integer, p_expected_version bigint)
returns setof public.products
language plpgsql security definer set search_path = '' as $$
declare current_household uuid := public.require_household_membership();
begin
  perform public.require_household_mutation_access(current_household);
  if p_delta not in (-1, 1) then raise exception using errcode = '22023', message = 'invalid_quantity_delta'; end if;
  return query update public.products set quantity = quantity + p_delta
  where id = p_product_id and household_id = current_household and version = p_expected_version and quantity + p_delta between 1 and 999 returning *;
  if not found then
    if exists (select 1 from public.products where id = p_product_id and household_id = current_household and version = p_expected_version) then
      raise exception using errcode = '22003', message = 'quantity_out_of_range';
    end if;
    raise exception using errcode = 'PT409', message = 'product_conflict';
  end if;
end $$;

create or replace function public.toggle_product_picked(p_product_id uuid, p_expected_version bigint, p_expected_picked boolean)
returns setof public.products
language plpgsql security definer set search_path = '' as $$
declare current_household uuid := public.require_household_membership();
begin
  perform public.require_household_mutation_access(current_household);
  return query update public.products set is_picked = not p_expected_picked,
      picked_at = case when not p_expected_picked then now() else null end,
      ordering_at = now()
  where id = p_product_id and household_id = current_household and version = p_expected_version and is_picked = p_expected_picked returning *;
  if not found then raise exception using errcode = 'PT409', message = 'product_conflict'; end if;
end $$;

create or replace function public.update_product(p_product_id uuid, p_name text, p_quantity text, p_notes text, p_category text, p_expected_version bigint)
returns setof public.products
language plpgsql security definer set search_path = '' as $$
declare parsed_quantity numeric; current_household uuid := public.require_household_membership();
begin
  perform public.require_household_mutation_access(current_household);
  if p_quantity !~ '^[0-9]{1,3}([.][0-9]{1,2})?$' then raise exception using errcode = '22023', message = 'invalid_quantity'; end if;
  parsed_quantity := p_quantity::numeric;
  if parsed_quantity < 1 or parsed_quantity > 999 then raise exception using errcode = '22023', message = 'invalid_quantity'; end if;
  return query update public.products set name = p_name, quantity = parsed_quantity,
    notes = nullif(regexp_replace(p_notes, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), category = p_category
  where id = p_product_id and household_id = current_household and version = p_expected_version returning *;
  if not found then raise exception using errcode = 'PT409', message = 'product_conflict'; end if;
end $$;

create or replace function public.update_product(p_product_id uuid, p_name text, p_quantity text, p_notes text, p_expected_version bigint)
returns setof public.products
language plpgsql security definer set search_path = '' as $$
declare parsed_quantity numeric; current_household uuid := public.require_household_membership();
begin
  perform public.require_household_mutation_access(current_household);
  if p_quantity !~ '^[0-9]{1,3}([.][0-9]{1,2})?$' then raise exception using errcode = '22023', message = 'invalid_quantity'; end if;
  parsed_quantity := p_quantity::numeric;
  if parsed_quantity < 1 or parsed_quantity > 999 then raise exception using errcode = '22023', message = 'invalid_quantity'; end if;
  return query update public.products set name = p_name, quantity = parsed_quantity,
    notes = nullif(regexp_replace(p_notes, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '')
  where id = p_product_id and household_id = current_household and version = p_expected_version returning *;
  if not found then raise exception using errcode = 'PT409', message = 'product_conflict'; end if;
end $$;

create or replace function public.delete_product(p_product_id uuid, p_expected_version bigint)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare current_household uuid := public.require_household_membership();
begin
  perform public.require_household_mutation_access(current_household);
  delete from public.products where id = p_product_id and household_id = current_household and version = p_expected_version;
  if not found then raise exception using errcode = 'PT409', message = 'product_conflict'; end if;
  return true;
end $$;

create or replace function public.restore_all_products(p_clear_notes boolean default false, p_reset_quantities boolean default false)
returns setof public.products
language plpgsql security definer set search_path = '' as $$
declare current_household uuid := public.require_household_membership();
begin
  perform public.require_household_mutation_access(current_household);
  return query update public.products set is_picked = false, picked_at = null,
    notes = case when p_clear_notes then null else notes end,
    quantity = case when p_reset_quantities then 1 else quantity end,
    ordering_at = now()
  where household_id = current_household and is_picked = true returning *;
end $$;

revoke all on function public.create_product(text) from public;
revoke all on function public.adjust_product_quantity(uuid, integer, bigint) from public;
revoke all on function public.toggle_product_picked(uuid, bigint, boolean) from public;
revoke all on function public.update_product(uuid, text, text, text, bigint) from public;
revoke all on function public.update_product(uuid, text, text, text, text, bigint) from public;
revoke all on function public.delete_product(uuid, bigint) from public;
revoke all on function public.restore_all_products(boolean, boolean) from public;
grant execute on function public.create_product(text) to authenticated;
grant execute on function public.adjust_product_quantity(uuid, integer, bigint) to authenticated;
grant execute on function public.toggle_product_picked(uuid, bigint, boolean) to authenticated;
grant execute on function public.update_product(uuid, text, text, text, bigint) to authenticated;
grant execute on function public.update_product(uuid, text, text, text, text, bigint) to authenticated;
grant execute on function public.delete_product(uuid, bigint) to authenticated;
grant execute on function public.restore_all_products(boolean, boolean) to authenticated;

-- Reset is a product mutation and therefore obeys the same access boundary.
create or replace function public.reset_household(p_clear_products boolean, p_remove_members boolean)
returns table (products_deleted bigint, members_removed bigint)
language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  current_household_id uuid;
begin
  if current_user_id is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_clear_products is distinct from true and p_remove_members is distinct from true then raise exception using errcode = 'P0001', message = 'reset_choice_required'; end if;
  select membership.household_id into current_household_id
  from public.household_members as membership
  where membership.user_id = current_user_id and membership.role = 'admin';
  if current_household_id is null then raise exception using errcode = '42501', message = 'admin_required'; end if;
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
end $$;
revoke all on function public.reset_household(boolean, boolean) from public;
grant execute on function public.reset_household(boolean, boolean) to authenticated;
