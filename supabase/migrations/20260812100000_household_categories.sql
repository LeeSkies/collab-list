begin;

-- Categories become household-owned rows. The ten built-in names are seeded
-- for every existing household so the text-column backfill below is exact,
-- and the table stays deliberately small: no key, sort_order, or is_default.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  constraint categories_name_length check (char_length(name) between 1 and 80),
  constraint categories_name_trimmed check (name = btrim(name))
);

-- Case-insensitive uniqueness per household. The frontend and database sort
-- categories by name, and this index doubles as the source of that order.
create unique index categories_household_name_key
  on public.categories (household_id, lower(name));
-- Unique (household_id, id) so the composite product foreign key below can
-- reference the household/identity pair instead of a bare global id.
create unique index categories_household_id_idx
  on public.categories (household_id, id);

-- Seed every household that exists at migration time with the ten built-in
-- category names. Idempotent for safety on re-run.
insert into public.categories(household_id, name)
select household.id, seed.name
from public.households as household
cross join (
  values
    ('fruit_vegetables'),
    ('dairy_eggs'),
    ('meat_fish'),
    ('bakery'),
    ('pantry'),
    ('frozen'),
    ('drinks'),
    ('snacks'),
    ('household'),
    ('other')
) as seed(name)
on conflict do nothing;

-- Attach every product to the category matching its prior text value before
-- the old column is removed, preserving existing assignments exactly.
alter table public.products add column category_id uuid;

update public.products as product
set category_id = category.id
from public.categories as category
where category.household_id = product.household_id
  and category.name = product.category;

-- Guard against any unbackfilled row before the column becomes NOT NULL.
do $$
begin
  if exists (select 1 from public.products where category_id is null) then
    raise exception using errcode = 'P0001', message = 'category_backfill_incomplete';
  end if;
end
$$;

alter table public.products alter column category_id set not null;

-- The composite foreign key makes cross-household category references
-- structurally impossible; referenced categories are not deletable yet.
alter table public.products
  add constraint products_household_category_fkey
  foreign key (household_id, category_id)
  references public.categories (household_id, id)
  on delete restrict;

-- New products keep their current behavior: the household's `other` category.
create or replace function public.create_product(p_name text)
returns setof public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_household uuid := public.require_household_membership();
  default_category_id uuid;
begin
  perform public.require_household_mutation_access(current_household);

  select category.id
  into default_category_id
  from public.categories as category
  where category.household_id = current_household
    and category.name = 'other';

  if default_category_id is null then
    raise exception using errcode = 'P0001', message = 'default_category_missing';
  end if;

  return query
  insert into public.products(household_id, category_id, name, name_signature, created_by)
  values (current_household, default_category_id, p_name, public.product_name_signature(p_name), auth.uid())
  returning *;
end
$$;

-- The versioned drawer save now resolves the category by household-owned id.
-- The composite foreign key rejects ids from another household as 23503.
drop function if exists public.update_product(uuid, text, text, text, bigint);

create or replace function public.update_product(
  p_product_id uuid,
  p_name text,
  p_quantity text,
  p_notes text,
  p_category_id uuid,
  p_expected_version bigint
)
returns setof public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  parsed_quantity numeric;
  current_household uuid := public.require_household_membership();
begin
  perform public.require_household_mutation_access(current_household);

  if p_quantity !~ '^[0-9]{1,3}([.][0-9]{1,2})?$' then
    raise exception using errcode = '22023', message = 'invalid_quantity';
  end if;
  parsed_quantity := p_quantity::numeric;
  if parsed_quantity < 1 or parsed_quantity > 999 then
    raise exception using errcode = '22023', message = 'invalid_quantity';
  end if;

  return query
  update public.products
  set name = p_name,
      quantity = parsed_quantity,
      notes = nullif(regexp_replace(p_notes, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
      category_id = p_category_id
  where id = p_product_id
    and household_id = current_household
    and version = p_expected_version
  returning *;

  if not found then
    raise exception using errcode = 'PT409', message = 'product_conflict';
  end if;
end
$$;

-- The obsolete text-category overload is gone; old-client compatibility is
-- not required.
drop function if exists public.update_product(uuid, text, text, text, text, bigint);

revoke all on function public.create_product(text) from public;
revoke all on function public.update_product(uuid, text, text, text, uuid, bigint) from public;
grant execute on function public.create_product(text) to authenticated;
grant execute on function public.update_product(uuid, text, text, text, uuid, bigint) to authenticated;

-- Remove the legacy text column; its CHECK constraint leaves with it.
alter table public.products drop column category;

-- Members can list only their own household's categories through PostgREST.
alter table public.categories enable row level security;

create policy categories_read_member
on public.categories for select
to authenticated
using (public.is_household_member(household_id));

revoke all on public.categories from anon, authenticated;
grant select on public.categories to authenticated;

-- Household creation seeds the ten categories in the live creation RPC so a
-- fresh (or recreated) household always has its default categories. The rest
-- of the creation contract is intentionally unchanged from ticket 10.
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

  insert into public.categories(household_id, name)
  select created_household_id, seed.name
  from (
    values
      ('fruit_vegetables'),
      ('dairy_eggs'),
      ('meat_fish'),
      ('bakery'),
      ('pantry'),
      ('frozen'),
      ('drinks'),
      ('snacks'),
      ('household'),
      ('other')
  ) as seed(name);

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
