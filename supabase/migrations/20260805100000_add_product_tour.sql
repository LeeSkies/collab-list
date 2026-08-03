alter table public.profiles
add column product_tour_completed_at timestamptz;

-- Accounts that existed before the tour was introduced should never see it.
update public.profiles
set product_tour_completed_at = coalesce(product_tour_completed_at, now())
where product_tour_completed_at is null;

create or replace function public.complete_product_tour()
returns table (product_tour_completed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := public.require_authenticated();
begin
  update public.profiles
  set product_tour_completed_at = coalesce(public.profiles.product_tour_completed_at, now())
  where id = current_user_id
  returning public.profiles.product_tour_completed_at into product_tour_completed_at;

  if not found then
    raise exception using errcode = 'P0002', message = 'profile_required';
  end if;

  return next;
end
$$;

revoke all on function public.complete_product_tour() from public;
grant execute on function public.complete_product_tour() to authenticated;
