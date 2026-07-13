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
      picked_by = null,
      notes = case when p_clear_notes then null else notes end,
      quantity = case when p_reset_quantities then 1 else quantity end,
      ordering_at = now()
  where is_picked = true
  returning *;
end
$$;

revoke all on function public.restore_all_products(boolean, boolean) from public;
grant execute on function public.restore_all_products(boolean, boolean) to authenticated;
