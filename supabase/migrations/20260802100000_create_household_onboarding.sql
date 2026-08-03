create table public.household_trials (
  household_id uuid primary key references public.households(id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint household_trials_dates check (ends_at = starts_at + interval '14 days')
);

alter table public.household_trials enable row level security;

create policy household_trials_read_member
on public.household_trials for select
to authenticated
using (public.is_household_member(household_id));

revoke all on public.household_trials from anon, authenticated;
grant select on public.household_trials to authenticated;

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
    select 1
    from auth.users
    where id = current_user_id
      and email_confirmed_at is not null
  ) then
    raise exception using errcode = '42501', message = 'email_confirmation_required';
  end if;

  select hm.household_id, hm.role
  into existing_household_id, existing_household_role
  from public.household_members as hm
  where hm.user_id = current_user_id;

  if existing_household_id is not null then
    if existing_household_role <> 'admin' then
      raise exception using errcode = '23505', message = 'household_membership_exists';
    end if;

    select h.id, h.name, t.starts_at, t.ends_at
    into household_id, household_name, trial_starts_at, trial_ends_at
    from public.households as h
    join public.household_trials as t on t.household_id = h.id
    where h.id = existing_household_id;

    if not found then
      raise exception using errcode = '23505', message = 'household_membership_exists';
    end if;

    return next;
    return;
  end if;

  select nullif(btrim(name), '')
  into creator_name
  from public.profiles
  where id = current_user_id;

  if creator_name is null then
    raise exception using errcode = 'P0002', message = 'profile_required';
  end if;

  generated_name := left(creator_name, 80 - char_length('''s household')) || '''s household';
  created_trial_starts_at := now();
  created_trial_ends_at := created_trial_starts_at + interval '14 days';

  insert into public.households(name)
  values (generated_name)
  returning id, name into created_household_id, household_name;

  insert into public.household_members(household_id, user_id, role)
  values (created_household_id, current_user_id, 'admin');

  insert into public.household_trials(household_id, starts_at, ends_at)
  values (created_household_id, created_trial_starts_at, created_trial_ends_at);

  household_id := created_household_id;
  trial_starts_at := created_trial_starts_at;
  trial_ends_at := created_trial_ends_at;
  return next;
end
$$;

revoke all on function public.create_household_with_trial() from public;
grant execute on function public.create_household_with_trial() to authenticated;
