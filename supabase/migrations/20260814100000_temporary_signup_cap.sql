-- Keep the public signup surface available for a small, temporary cohort.
-- The trigger enforces the cap at the Auth boundary, so direct Supabase Auth
-- calls cannot bypass the limit. Disable the feature flag when the cohort is
-- complete or the cap is no longer needed.
insert into public.feature_flags(key, enabled)
values ('temporary_signup_cap', true)
on conflict (key) do nothing;

create or replace function public.enforce_temporary_signup_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap_enabled boolean;
  account_count bigint;
begin
  select flag.enabled
  into cap_enabled
  from public.feature_flags as flag
  where flag.key = 'temporary_signup_cap';

  if coalesce(cap_enabled, false) then
    -- Serialize the count-and-insert decision so concurrent signups cannot
    -- consume the final slot at the same time.
    perform pg_catalog.pg_advisory_xact_lock(817263514::bigint);
    select count(*) into account_count from auth.users;

    if account_count >= 20 then
      raise exception using
        errcode = 'P0001',
        message = 'signup_limit_reached',
        detail = 'This project is temporarily limited to 20 accounts.';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.enforce_temporary_signup_cap() from public;

drop trigger if exists enforce_temporary_signup_cap on auth.users;
create trigger enforce_temporary_signup_cap
before insert on auth.users
for each row execute function public.enforce_temporary_signup_cap();
