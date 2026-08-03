create or replace function public.reset_household(
  p_clear_products boolean,
  p_remove_members boolean
)
returns table (
  products_deleted bigint,
  members_removed bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_household_id uuid;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_clear_products is distinct from true
     and p_remove_members is distinct from true then
    raise exception using errcode = 'P0001', message = 'reset_choice_required';
  end if;

  select membership.household_id
  into current_household_id
  from public.household_members as membership
  where membership.user_id = current_user_id
    and membership.role = 'admin';
  if current_household_id is null then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;

  -- Serialize the reset with member and invite operations so no request or
  -- invite can become active while the household is being cleared.
  perform 1 from public.households where id = current_household_id for update;

  if p_clear_products then
    delete from public.products
    where household_id = current_household_id;
    get diagnostics products_deleted = row_count;
  else
    products_deleted := 0;
  end if;

  if p_remove_members then
    -- Requests are notifications/access reservations, so remove all of them
    -- rather than leaving a stale pending request for a removed account.
    delete from public.household_join_requests
    where household_id = current_household_id;

    update public.household_invites
    set revoked_at = now()
    where household_id = current_household_id
      and revoked_at is null;

    delete from public.household_members
    where household_id = current_household_id
      and user_id <> current_user_id;
    get diagnostics members_removed = row_count;
  else
    members_removed := 0;
  end if;

  return next;
end
$$;

revoke all on function public.reset_household(boolean, boolean) from public;
grant execute on function public.reset_household(boolean, boolean) to authenticated;
