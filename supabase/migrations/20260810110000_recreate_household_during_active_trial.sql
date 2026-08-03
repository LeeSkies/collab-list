begin;

-- Household deletion removes the owned household, but it must not erase the
-- account's original trial anchor. That anchor is needed to determine whether
-- a former admin may create a replacement household during the same trial.
alter table public.account_trial_eligibility
  drop constraint if exists account_trial_owned_dates;

alter table public.account_trial_eligibility
  add constraint account_trial_owned_dates check (
    owned_household_id is null or owned_trial_started_at is not null
  );

create or replace function public.preserve_owned_trial_start()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.owned_household_id is not null
     and new.owned_household_id is null
     and new.owned_trial_started_at is null then
    new.owned_trial_started_at := old.owned_trial_started_at;
  end if;
  return new;
end
$$;

drop trigger if exists account_trial_eligibility_preserve_trial on public.account_trial_eligibility;
create trigger account_trial_eligibility_preserve_trial
before update on public.account_trial_eligibility
for each row execute function public.preserve_owned_trial_start();

-- A replacement household may reuse the remaining time of an active owned
-- trial. It never receives a new fourteen-day period.
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

  if eligibility_row.owned_household_id is not null then
    raise exception using errcode = 'P0001', message = 'trial_eligibility_consumed';
  end if;
  if eligibility_row.eligibility_consumed_at is not null
     and (eligibility_row.owned_trial_started_at is null
       or eligibility_row.owned_trial_started_at + interval '14 days' <= now()) then
    raise exception using errcode = 'P0001', message = 'trial_eligibility_consumed';
  end if;
  if eligibility_row.eligibility_consumed_at is null
     and eligibility_row.exposure_days >= 7 then
    raise exception using errcode = 'P0001', message = 'trial_eligibility_consumed';
  end if;

  update public.account_trial_eligibility
  set owned_household_id = p_household_id,
      owned_trial_started_at = coalesce(eligibility_row.owned_trial_started_at, p_starts_at),
      eligibility_consumed_at = coalesce(eligibility_row.eligibility_consumed_at, p_starts_at)
  where user_id = current_user_id;
end
$$;

revoke all on function public.claim_owned_household_trial(uuid, timestamptz) from public;

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
  eligibility_row public.account_trial_eligibility;
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

  insert into public.account_trial_eligibility(user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;
  perform public.sync_account_trial_eligibility(current_user_id);
  select * into eligibility_row
  from public.account_trial_eligibility
  where user_id = current_user_id
  for update;

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

  if eligibility_row.eligibility_consumed_at is not null then
    if eligibility_row.owned_trial_started_at is null
       or eligibility_row.owned_trial_started_at + interval '14 days' <= now() then
      raise exception using errcode = 'P0001', message = 'trial_eligibility_consumed';
    end if;
    created_trial_starts_at := eligibility_row.owned_trial_started_at;
  else
    created_trial_starts_at := now();
  end if;
  created_trial_ends_at := created_trial_starts_at + interval '14 days';

  select nullif(btrim(name), '') into creator_name
  from public.profiles where id = current_user_id;
  if creator_name is null then
    raise exception using errcode = 'P0002', message = 'profile_required';
  end if;

  generated_name := left(creator_name, 80 - char_length('''s household')) || '''s household';
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

commit;
