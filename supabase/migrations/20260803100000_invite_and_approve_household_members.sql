create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  token_hash bytea not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint household_invites_expiry check (expires_at > created_at),
  constraint household_invites_hash_length check (octet_length(token_hash) = 32)
);

create unique index household_invites_one_unrevoked
  on public.household_invites(household_id)
  where revoked_at is null;
create index household_invites_token_hash_idx on public.household_invites(token_hash);

create table public.household_join_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  invite_id uuid not null references public.household_invites(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  handled_at timestamptz,
  constraint household_join_requests_expiry check (expires_at > created_at)
);

create unique index household_join_requests_one_pending
  on public.household_join_requests(household_id, user_id)
  where status = 'pending';
create index household_join_requests_household_pending_idx
  on public.household_join_requests(household_id, status, expires_at);
create index household_join_requests_user_idx
  on public.household_join_requests(user_id, created_at desc);

create trigger household_join_requests_updated_at
before update on public.household_join_requests
for each row execute function public.set_updated_at();

alter table public.household_invites enable row level security;
alter table public.household_join_requests enable row level security;

-- The raw invite token and its hash are never selectable. All invite access is
-- through narrowly shaped functions below.
revoke all on public.household_invites, public.household_join_requests from anon, authenticated;
grant select on public.household_join_requests to authenticated;

create policy household_join_requests_read_self_or_admin
on public.household_join_requests for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.household_members as membership
    where membership.household_id = household_join_requests.household_id
      and membership.user_id = auth.uid()
      and membership.role = 'admin'
  )
);

alter publication supabase_realtime add table public.household_join_requests;

create or replace function public.expire_household_join_requests(p_household_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.household_join_requests
  set status = 'expired', handled_at = coalesce(handled_at, now())
  where household_id = p_household_id
    and status = 'pending'
    and expires_at <= now();
$$;

create or replace function public.invite_household_member()
returns table (
  invite_token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_household_id uuid;
  raw_token text;
  invite_expiry timestamptz;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select household_id
  into current_household_id
  from public.household_members
  where user_id = current_user_id and role = 'admin';
  if current_household_id is null then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;

  -- Lock the household so rotation and concurrent request capacity checks have
  -- one serial order. The previous link is revoked before the new token exists.
  perform 1 from public.households where id = current_household_id for update;
  update public.household_invites
  set revoked_at = now()
  where household_id = current_household_id and revoked_at is null;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  invite_expiry := now() + interval '12 hours';
  insert into public.household_invites(
    household_id, token_hash, expires_at, created_by
  ) values (
    current_household_id,
    extensions.digest(convert_to(raw_token, 'UTF8'), 'sha256'),
    invite_expiry,
    current_user_id
  );

  invite_token := raw_token;
  expires_at := invite_expiry;
  return next;
end
$$;

create or replace function public.preview_household_invite(p_token text)
returns table (
  household_name text,
  approval_required boolean
)
language sql
security definer
set search_path = ''
as $$
  select h.name, true
  from public.household_invites as invite
  join public.households as h on h.id = invite.household_id
  where invite.token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
    and invite.revoked_at is null
    and invite.expires_at > now()
  limit 1;
$$;

create or replace function public.request_household_access(p_token text)
returns table (
  request_id uuid,
  household_name text,
  status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  invite_household_id uuid;
  invite_id uuid;
  invite_household_name text;
  current_request public.household_join_requests;
  current_membership public.household_members;
  active_member_count bigint;
  pending_request_count bigint;
  next_expiry timestamptz;
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

  -- Find the household row without trusting the link's current validity. The
  -- lock linearizes this request against invite rotation; validity is checked
  -- again after the lock is held.
  select invite.household_id
  into invite_household_id
  from public.household_invites as invite
  where invite.token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
  limit 1;
  if invite_household_id is null then
    raise exception using errcode = '22023', message = 'invite_invalid_or_expired';
  end if;
  perform 1 from public.households where id = invite_household_id for update;

  select invite.id, invite.household_id, household.name
  into invite_id, invite_household_id, invite_household_name
  from public.household_invites as invite
  join public.households as household on household.id = invite.household_id
  where invite.token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
    and invite.revoked_at is null
    and invite.expires_at > now()
  limit 1;
  if invite_household_id is null then
    raise exception using errcode = '22023', message = 'invite_invalid_or_expired';
  end if;

  select * into current_membership
  from public.household_members
  where user_id = current_user_id;
  if current_membership.user_id is not null then
    if current_membership.household_id <> invite_household_id then
      raise exception using errcode = '23505', message = 'account_belongs_to_another_household';
    end if;
    request_id := null;
    household_name := invite_household_name;
    status := 'approved';
    expires_at := null;
    return next;
    return;
  end if;

  -- All request creation/reopening for a household is serialized by the
  -- household row. Expired reservations are released before counting seats.
  perform public.expire_household_join_requests(invite_household_id);

  select request.* into current_request
  from public.household_join_requests as request
  where request.household_id = invite_household_id
    and request.user_id = current_user_id
    and request.status = 'pending'
  for update;

  if current_request.id is not null then
    request_id := current_request.id;
    household_name := invite_household_name;
    status := current_request.status;
    expires_at := current_request.expires_at;
    return next;
    return;
  end if;

  select count(*) into active_member_count
  from public.household_members
  where household_id = invite_household_id;
  select count(*) into pending_request_count
  from public.household_join_requests as request
  where request.household_id = invite_household_id and request.status = 'pending';
  if active_member_count + pending_request_count >= 5 then
    raise exception using errcode = 'P0001', message = 'household_capacity_reached';
  end if;

  next_expiry := now() + interval '7 days';
  insert into public.household_join_requests(
    household_id, invite_id, user_id, status, expires_at
  ) values (
    invite_household_id, invite_id, current_user_id, 'pending', next_expiry
  ) returning id into request_id;
  household_name := invite_household_name;
  status := 'pending';
  expires_at := next_expiry;
  return next;
end
$$;

create or replace function public.current_household_invite_request(p_token text)
returns table (
  household_name text,
  status text,
  expires_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select household.name, request.status, request.expires_at
  from public.household_invites as invite
  join public.households as household on household.id = invite.household_id
  join public.household_join_requests as request
    on request.invite_id = invite.id
   and request.user_id = auth.uid()
  where invite.token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
  order by request.created_at desc
  limit 1;
$$;

create or replace function public.list_pending_household_requests(p_household_id uuid)
returns table (
  request_id uuid,
  name text,
  email text,
  requested_at timestamptz,
  expires_at timestamptz
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
  if not exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = current_user_id and role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;

  perform 1 from public.households where id = p_household_id for update;
  perform public.expire_household_join_requests(p_household_id);
  return query
  select request.id, profile.name, profile.email, request.created_at, request.expires_at
  from public.household_join_requests as request
  join public.profiles as profile on profile.id = request.user_id
  where request.household_id = p_household_id and request.status = 'pending'
  order by request.created_at asc, request.id asc;
end
$$;

create or replace function public.approve_household_request(p_request_id uuid)
returns table (request_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  request_row public.household_join_requests;
  active_member_count bigint;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select request.* into request_row
  from public.household_join_requests as request
  where request.id = p_request_id;
  if request_row.id is null then
    raise exception using errcode = 'P0002', message = 'request_not_found';
  end if;
  perform 1 from public.households where id = request_row.household_id for update;
  if not exists (
    select 1 from public.household_members
    where household_id = request_row.household_id
      and user_id = current_user_id
      and role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;

  select * into request_row
  from public.household_join_requests
  where id = p_request_id
  for update;
  if request_row.status <> 'pending' then
    request_id := request_row.id;
    status := request_row.status;
    return next;
    return;
  end if;
  if request_row.expires_at <= now() then
    update public.household_join_requests
    set status = 'expired', handled_at = now()
    where id = request_row.id;
    request_id := request_row.id;
    status := 'expired';
    return next;
    return;
  end if;

  select count(*) into active_member_count
  from public.household_members
  where household_id = request_row.household_id;
  if active_member_count >= 5 then
    raise exception using errcode = 'P0001', message = 'household_capacity_reached';
  end if;

  begin
    insert into public.household_members(household_id, user_id, role)
    values (request_row.household_id, request_row.user_id, 'member');
  exception when unique_violation then
    if exists (
      select 1 from public.household_members
      where user_id = request_row.user_id and household_id <> request_row.household_id
    ) then
      raise exception using errcode = '23505', message = 'account_belongs_to_another_household';
    end if;
    raise;
  end;
  update public.household_join_requests
  set status = 'approved', handled_at = now()
  where id = request_row.id;
  request_id := request_row.id;
  status := 'approved';
  return next;
end
$$;

create or replace function public.reject_household_request(p_request_id uuid)
returns table (request_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  request_row public.household_join_requests;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select * into request_row from public.household_join_requests where id = p_request_id;
  if request_row.id is null then
    raise exception using errcode = 'P0002', message = 'request_not_found';
  end if;
  perform 1 from public.households where id = request_row.household_id for update;
  if not exists (
    select 1 from public.household_members
    where household_id = request_row.household_id
      and user_id = current_user_id
      and role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  select * into request_row from public.household_join_requests where id = p_request_id for update;
  if request_row.status = 'pending' then
    update public.household_join_requests
    set status = 'rejected', handled_at = now()
    where id = request_row.id;
    request_row.status := 'rejected';
  end if;
  request_id := request_row.id;
  status := request_row.status;
  return next;
end
$$;

revoke all on function public.expire_household_join_requests(uuid) from public;
revoke all on function public.invite_household_member() from public;
revoke all on function public.preview_household_invite(text) from public;
revoke all on function public.request_household_access(text) from public;
revoke all on function public.current_household_invite_request(text) from public;
revoke all on function public.list_pending_household_requests(uuid) from public;
revoke all on function public.approve_household_request(uuid) from public;
revoke all on function public.reject_household_request(uuid) from public;
grant execute on function public.invite_household_member() to authenticated;
grant execute on function public.preview_household_invite(text) to anon, authenticated;
grant execute on function public.request_household_access(text) to authenticated;
grant execute on function public.current_household_invite_request(text) to authenticated;
grant execute on function public.list_pending_household_requests(uuid) to authenticated;
grant execute on function public.approve_household_request(uuid) to authenticated;
grant execute on function public.reject_household_request(uuid) to authenticated;
