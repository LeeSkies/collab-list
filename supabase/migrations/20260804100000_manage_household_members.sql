create or replace function public.list_household_members(p_household_id uuid)
returns table (
  user_id uuid,
  name text,
  email text,
  role text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  -- Lock the household before checking or returning membership data so this
  -- read is ordered with member removal and invite rotation.
  perform 1 from public.households where id = p_household_id for update;
  if not exists (
    select 1
    from public.household_members as membership
    where membership.household_id = p_household_id
      and membership.user_id = current_user_id
      and membership.role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;

  return query
  select membership.user_id,
         profile.name,
         profile.email,
         membership.role,
         membership.created_at
  from public.household_members as membership
  join public.profiles as profile on profile.id = membership.user_id
  where membership.household_id = p_household_id
  order by membership.created_at, membership.user_id;
end
$$;

create or replace function public.remove_household_member(
  p_household_id uuid,
  p_user_id uuid
)
returns table (user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  -- Serializing removals with invite rotation prevents a removed member from
  -- racing the revocation of the invite they previously received.
  perform 1 from public.households where id = p_household_id for update;
  if not exists (
    select 1
    from public.household_members as membership
    where membership.household_id = p_household_id
      and membership.user_id = current_user_id
      and membership.role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;

  if p_user_id = current_user_id then
    raise exception using errcode = 'P0001', message = 'member_self_removal';
  end if;

  delete from public.household_members as membership
  where membership.household_id = p_household_id
    and membership.user_id = p_user_id
    and membership.role = 'member';
  if not found then
    raise exception using errcode = 'P0002', message = 'household_member_not_found';
  end if;

  -- A removed member must receive a newly rotated invite before requesting
  -- access again. Pending requests remain untouched until an admin handles them.
  update public.household_invites
  set revoked_at = now()
  where household_id = p_household_id
    and revoked_at is null;

  user_id := p_user_id;
  return next;
end
$$;

revoke all on function public.list_household_members(uuid) from public;
revoke all on function public.remove_household_member(uuid, uuid) from public;
grant execute on function public.list_household_members(uuid) to authenticated;
grant execute on function public.remove_household_member(uuid, uuid) to authenticated;
