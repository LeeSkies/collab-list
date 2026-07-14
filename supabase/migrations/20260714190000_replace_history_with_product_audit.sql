alter table public.products
  add column updated_by uuid references public.profiles(id) on delete set null default auth.uid();

alter table public.products disable trigger products_prepare;
alter table public.products disable trigger products_updated_at;
update public.products
set updated_by = created_by
where updated_by is null;
alter table public.products enable trigger products_prepare;
alter table public.products enable trigger products_updated_at;

drop trigger if exists product_pick_event on public.products;
drop function if exists public.record_product_pick();

alter publication supabase_realtime drop table public.product_pick_history;
drop table public.product_pick_history;

create or replace function public.set_product_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  new.updated_by = coalesce(auth.uid(), new.updated_by, old.updated_by);
  return new;
end
$$;

drop trigger products_updated_at on public.products;
create trigger products_updated_at
before update on public.products
for each row execute function public.set_product_updated_at();

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
begin
  perform public.require_authenticated();
  return query update public.products
  set is_picked = not p_expected_picked,
      picked_at = case when not p_expected_picked then now() else null end,
      ordering_at = now()
  where id = p_product_id
    and version = p_expected_version
    and is_picked = p_expected_picked
  returning *;
  if not found then
    raise exception using errcode = '40001', message = 'product_conflict';
  end if;
end
$$;

alter table public.products drop column picked_by;

create or replace function public.restore_all_products(
  p_clear_notes boolean default false,
  p_reset_quantities boolean default false
)
returns setof public.products
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_authenticated();

  return query
  update public.products
  set is_picked = false,
      picked_at = null,
      notes = case when p_clear_notes then null else notes end,
      quantity = case when p_reset_quantities then 1 else quantity end,
      ordering_at = now()
  where is_picked = true
  returning *;
end
$$;
