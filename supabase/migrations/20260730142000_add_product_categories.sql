alter table public.products
  add column category text not null default 'other'
  constraint products_category_valid check (
    category in (
      'fruit_vegetables',
      'dairy_eggs',
      'meat_fish',
      'bakery',
      'pantry',
      'frozen',
      'drinks',
      'snacks',
      'household',
      'other'
    )
  );

create function public.update_product(
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
      notes = nullif(regexp_replace(p_notes, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
      category = p_category
  where id = p_product_id
    and version = p_expected_version
  returning *;

  if not found then
    raise exception using errcode = 'PT409', message = 'product_conflict';
  end if;
end
$$;

revoke all on function public.update_product(uuid, text, text, text, text, bigint) from public;
grant execute on function public.update_product(uuid, text, text, text, text, bigint) to authenticated;
