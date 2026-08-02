create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My household',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint households_name_length check (char_length(name) between 1 and 80),
  constraint households_name_trimmed check (name = btrim(name))
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, user_id),
  constraint household_members_one_household_per_user unique (user_id)
);

create unique index household_members_one_admin_idx
  on public.household_members(household_id)
  where role = 'admin';

create index household_members_user_idx on public.household_members(user_id);

create trigger households_updated_at
before update on public.households
for each row execute function public.set_updated_at();

create trigger household_members_updated_at
before update on public.household_members
for each row execute function public.set_updated_at();

-- The existing global admin and member records become the first household.
do $$
declare
  first_household_id uuid;
  first_admin_id uuid;
  household_name text;
begin
  select p.id
  into first_admin_id
  from public.profiles as p
  where p.role = 'admin'
  order by p.created_at, p.id
  limit 1;

  if first_admin_id is null then
    select p.id
    into first_admin_id
    from public.profiles as p
    order by p.created_at, p.id
    limit 1;
  end if;

  if first_admin_id is null then
    if exists (select 1 from public.products) then
      raise exception using
        errcode = 'P0001',
        message = 'cannot scope existing products: no profile is available for the first household';
    end if;
    return;
  end if;

  select left(
    btrim(coalesce((select p.name from public.profiles as p where p.id = first_admin_id), 'My'))
      || '''s household',
    80
  )
  into household_name;

  insert into public.households(name)
  values (coalesce(nullif(household_name, ''), 'My household'))
  returning id into first_household_id;

  insert into public.household_members(household_id, user_id, role)
  select first_household_id, p.id, case when p.id = first_admin_id then 'admin' else 'member' end
  from public.profiles as p;
end
$$;

alter table public.products add column household_id uuid;

update public.products
set household_id = (select id from public.households order by created_at, id limit 1)
where household_id is null;

alter table public.products
  alter column household_id set not null,
  add constraint products_household_fkey
    foreign key (household_id) references public.households(id) on delete cascade;

ALTER TABLE public.products REPLICA IDENTITY FULL;

alter table public.products drop constraint if exists products_name_signature_key;
create unique index products_household_name_signature_key
  on public.products(household_id, name_signature);
create index products_household_section_order_idx
  on public.products(household_id, is_picked, ordering_at desc, id);

create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select household_id
  from public.household_members
  where user_id = auth.uid()
  limit 1
$$;

create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_household_id is not null
    and exists (
      select 1
      from public.household_members
      where household_id = p_household_id
        and user_id = auth.uid()
    )
$$;

create or replace function public.require_household_membership()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_household uuid;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select household_id
  into current_household
  from public.household_members
  where user_id = current_user_id
  limit 1;

  if current_household is null then
    raise exception using errcode = '42501', message = 'household_membership_required';
  end if;
  return current_household;
end
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;

create policy households_read_member
on public.households for select
to authenticated
using (public.is_household_member(id));

create policy household_members_read_member
on public.household_members for select
to authenticated
using (user_id = auth.uid() or public.is_household_member(household_id));

-- Membership, not profiles.role, is the authorization boundary. Keep the legacy
-- role column for old clients while all new users start as unassigned members.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text := btrim(coalesce(new.raw_user_meta_data ->> 'name', ''));
begin
  if profile_name = '' then
    profile_name := initcap(regexp_replace(split_part(new.email, '@', 1), '[._-]+', ' ', 'g'));
  end if;
  if char_length(profile_name) > 80 then
    raise exception using errcode = '22023', message = 'invalid_profile_name';
  end if;

  insert into public.profiles(id, email, name, role)
  values (new.id, lower(new.email), profile_name, 'member');
  return new;
end
$$;

drop policy if exists profiles_read_authenticated on public.profiles;
create policy profiles_read_member
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.household_members as viewer_membership
    join public.household_members as profile_membership
      on profile_membership.household_id = viewer_membership.household_id
    where viewer_membership.user_id = auth.uid()
      and profile_membership.user_id = profiles.id
  )
);

drop policy if exists products_read_authenticated on public.products;
create policy products_read_member
on public.products for select
to authenticated
using (public.is_household_member(household_id));

revoke all on public.households, public.household_members from anon, authenticated;
grant select on public.households, public.household_members to authenticated;

alter publication supabase_realtime add table public.household_members;

revoke all on function public.current_household_id() from public;
revoke all on function public.is_household_member(uuid) from public;
revoke all on function public.require_household_membership() from public;
grant execute on function public.current_household_id(), public.is_household_member(uuid), public.require_household_membership() to authenticated;

create or replace function public.create_product(p_name text)
returns setof public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_household uuid := public.require_household_membership();
begin
  return query
  insert into public.products(household_id, name, name_signature, created_by)
  values (current_household, p_name, public.product_name_signature(p_name), auth.uid())
  returning *;
end
$$;

create or replace function public.adjust_product_quantity(
  p_product_id uuid,
  p_delta integer,
  p_expected_version bigint
)
returns setof public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_household uuid := public.require_household_membership();
begin
  if p_delta not in (-1, 1) then
    raise exception using errcode = '22023', message = 'invalid_quantity_delta';
  end if;

  return query
  update public.products
  set quantity = quantity + p_delta
  where id = p_product_id
    and household_id = current_household
    and version = p_expected_version
    and quantity + p_delta between 1 and 999
  returning *;

  if not found then
    if exists (
      select 1
      from public.products
      where id = p_product_id
        and household_id = current_household
        and version = p_expected_version
    ) then
      raise exception using errcode = '22003', message = 'quantity_out_of_range';
    end if;
    raise exception using errcode = 'PT409', message = 'product_conflict';
  end if;
end
$$;

create or replace function public.toggle_product_picked(
  p_product_id uuid,
  p_expected_version bigint,
  p_expected_picked boolean
)
returns setof public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_household uuid := public.require_household_membership();
begin
  return query
  update public.products
  set is_picked = not p_expected_picked,
      picked_at = case when not p_expected_picked then now() else null end,
      ordering_at = now()
  where id = p_product_id
    and household_id = current_household
    and version = p_expected_version
    and is_picked = p_expected_picked
  returning *;

  if not found then
    raise exception using errcode = 'PT409', message = 'product_conflict';
  end if;
end
$$;

create or replace function public.update_product(
  p_product_id uuid,
  p_name text,
  p_quantity text,
  p_notes text,
  p_category text,
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
      category = p_category
  where id = p_product_id
    and household_id = current_household
    and version = p_expected_version
  returning *;

  if not found then
    raise exception using errcode = 'PT409', message = 'product_conflict';
  end if;
end
$$;

create or replace function public.update_product(
  p_product_id uuid,
  p_name text,
  p_quantity text,
  p_notes text,
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
      notes = nullif(regexp_replace(p_notes, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '')
  where id = p_product_id
    and household_id = current_household
    and version = p_expected_version
  returning *;

  if not found then
    raise exception using errcode = 'PT409', message = 'product_conflict';
  end if;
end
$$;

create or replace function public.delete_product(
  p_product_id uuid,
  p_expected_version bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_household uuid := public.require_household_membership();
begin
  delete from public.products
  where id = p_product_id
    and household_id = current_household
    and version = p_expected_version;

  if not found then
    raise exception using errcode = 'PT409', message = 'product_conflict';
  end if;
  return true;
end
$$;

create or replace function public.restore_all_products(
  p_clear_notes boolean default false,
  p_reset_quantities boolean default false
)
returns setof public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_household uuid := public.require_household_membership();
begin
  return query
  update public.products
  set is_picked = false,
      picked_at = null,
      notes = case when p_clear_notes then null else notes end,
      quantity = case when p_reset_quantities then 1 else quantity end,
      ordering_at = now()
  where household_id = current_household
    and is_picked = true
  returning *;
end
$$;

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
