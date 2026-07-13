create extension if not exists pgcrypto with schema extensions;

create or replace function public.normalize_product_name(input text)
returns text language sql immutable strict set search_path = '' as $$
  select regexp_replace(trim(normalize(input, NFKC)), '[[:space:]]+', ' ', 'g')
$$;

create or replace function public.product_name_signature(input text)
returns text language sql immutable strict set search_path = '' as $$
  select coalesce(string_agg(length(token)::text || ':' || token, '|' order by token collate "C"), '')
  from regexp_split_to_table(lower(normalize(input, NFKC)), '[^[:alnum:]]+') as token
  where token <> ''
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_signature text not null unique,
  quantity numeric(5,2) not null default 1 check (quantity between 1 and 999),
  notes text check (notes is null or char_length(notes) <= 500),
  is_picked boolean not null default false,
  picked_at timestamptz,
  picked_by uuid references public.profiles(id) on delete set null,
  ordering_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_picked_metadata check ((is_picked and picked_at is not null) or (not is_picked and picked_at is null))
);

create table public.product_pick_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  picked_at timestamptz not null default now(),
  picked_by uuid references public.profiles(id) on delete set null,
  picked_by_email text not null,
  created_at timestamptz not null default now()
);

create index products_section_order_idx on public.products(is_picked, ordering_at desc, id);
create index products_picked_order_idx on public.products(is_picked, picked_at desc, id);
create index product_pick_history_product_idx on public.product_pick_history(product_id, picked_at desc, id desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create or replace function public.prepare_product()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.name = public.normalize_product_name(new.name);
  if char_length(new.name) < 1 or char_length(new.name) > 80 then
    raise exception using errcode = '22023', message = 'invalid_product_name';
  end if;
  new.name_signature = public.product_name_signature(new.name);
  if new.name_signature = '' then
    raise exception using errcode = '22023', message = 'invalid_product_name';
  end if;
  if tg_op = 'UPDATE' then
    new.version = old.version + 1;
  end if;
  return new;
end
$$;

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger products_prepare before insert or update on public.products for each row execute function public.prepare_product();
create trigger products_updated_at before update on public.products for each row execute function public.set_updated_at();

create or replace function public.record_product_pick()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_picked and not old.is_picked then
    insert into public.product_pick_history(product_id, picked_at, picked_by, picked_by_email)
    select new.id, new.picked_at, new.picked_by, profile.email
    from public.profiles as profile
    where profile.id = new.picked_by;
  end if;
  return new;
end
$$;

create trigger product_pick_event after update on public.products for each row execute function public.record_product_pick();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, email, role)
  values (new.id, lower(new.email), case when not exists (select 1 from public.profiles where role = 'admin') then 'admin' else 'member' end);
  return new;
end
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.require_authenticated()
returns uuid language plpgsql stable set search_path = '' as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  return current_user_id;
end
$$;

create or replace function public.create_product(p_name text)
returns setof public.products language plpgsql security definer set search_path = '' as $$
begin
  return query insert into public.products(name, name_signature, created_by)
  values (p_name, public.product_name_signature(p_name), public.require_authenticated()) returning *;
end
$$;

create or replace function public.adjust_product_quantity(p_product_id uuid, p_delta integer, p_expected_version bigint)
returns setof public.products language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_authenticated();
  if p_delta not in (-1, 1) then raise exception using errcode = '22023', message = 'invalid_quantity_delta'; end if;
  return query update public.products set quantity = quantity + p_delta
  where id = p_product_id and version = p_expected_version and quantity + p_delta between 1 and 999 returning *;
  if not found then raise exception using errcode = '40001', message = 'product_conflict_or_quantity_bound'; end if;
end
$$;

create or replace function public.toggle_product_picked(p_product_id uuid, p_expected_version bigint, p_expected_picked boolean)
returns setof public.products language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := public.require_authenticated();
begin
  return query update public.products
  set is_picked = not p_expected_picked,
      picked_at = case when not p_expected_picked then now() else null end,
      picked_by = case when not p_expected_picked then current_user_id else null end,
      ordering_at = now()
  where id = p_product_id and version = p_expected_version and is_picked = p_expected_picked returning *;
  if not found then raise exception using errcode = '40001', message = 'product_conflict'; end if;
end
$$;

create or replace function public.update_product(p_product_id uuid, p_name text, p_quantity text, p_notes text, p_expected_version bigint)
returns setof public.products language plpgsql security definer set search_path = '' as $$
declare parsed_quantity numeric;
begin
  perform public.require_authenticated();
  if p_quantity !~ '^[0-9]{1,3}([.][0-9]{1,2})?$' then raise exception using errcode = '22023', message = 'invalid_quantity'; end if;
  parsed_quantity := p_quantity::numeric;
  if parsed_quantity < 1 or parsed_quantity > 999 then raise exception using errcode = '22023', message = 'invalid_quantity'; end if;
  return query update public.products set name = p_name, quantity = parsed_quantity, notes = nullif(regexp_replace(p_notes, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '')
  where id = p_product_id and version = p_expected_version returning *;
  if not found then raise exception using errcode = '40001', message = 'product_conflict'; end if;
end
$$;

create or replace function public.delete_product(p_product_id uuid, p_expected_version bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_authenticated();
  delete from public.products where id = p_product_id and version = p_expected_version;
  if not found then raise exception using errcode = '40001', message = 'product_conflict'; end if;
  return true;
end
$$;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_pick_history enable row level security;

create policy profiles_read_authenticated on public.profiles for select to authenticated using (true);
create policy products_read_authenticated on public.products for select to authenticated using (true);
create policy history_read_authenticated on public.product_pick_history for select to authenticated using (true);

revoke all on public.profiles, public.products, public.product_pick_history from anon, authenticated;
grant select on public.profiles, public.products, public.product_pick_history to authenticated;
grant execute on function public.create_product(text), public.adjust_product_quantity(uuid, integer, bigint), public.toggle_product_picked(uuid, bigint, boolean), public.update_product(uuid, text, text, text, bigint), public.delete_product(uuid, bigint) to authenticated;

alter publication supabase_realtime add table public.products;
alter publication supabase_realtime add table public.product_pick_history;
