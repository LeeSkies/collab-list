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
begin
  perform public.require_authenticated();

  if p_delta not in (-1, 1) then
    raise exception using errcode = '22023', message = 'invalid_quantity_delta';
  end if;

  return query
  update public.products
  set quantity = quantity + p_delta
  where id = p_product_id
    and version = p_expected_version
    and quantity + p_delta between 1 and 999
  returning *;

  if not found then
    if exists (
      select 1
      from public.products
      where id = p_product_id
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
begin
  perform public.require_authenticated();

  return query
  update public.products
  set is_picked = not p_expected_picked,
      picked_at = case when not p_expected_picked then now() else null end,
      ordering_at = now()
  where id = p_product_id
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
  p_expected_version bigint
)
returns setof public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  parsed_quantity numeric;
begin
  perform public.require_authenticated();

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
begin
  perform public.require_authenticated();

  delete from public.products
  where id = p_product_id
    and version = p_expected_version;

  if not found then
    raise exception using errcode = 'PT409', message = 'product_conflict';
  end if;
  return true;
end
$$;

revoke all on function public.adjust_product_quantity(uuid, integer, bigint) from public;
revoke all on function public.toggle_product_picked(uuid, bigint, boolean) from public;
revoke all on function public.update_product(uuid, text, text, text, bigint) from public;
revoke all on function public.delete_product(uuid, bigint) from public;

grant execute on function public.adjust_product_quantity(uuid, integer, bigint) to authenticated;
grant execute on function public.toggle_product_picked(uuid, bigint, boolean) to authenticated;
grant execute on function public.update_product(uuid, text, text, text, bigint) to authenticated;
grant execute on function public.delete_product(uuid, bigint) to authenticated;
