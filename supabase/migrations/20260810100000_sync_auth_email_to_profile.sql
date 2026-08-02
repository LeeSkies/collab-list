-- Email ownership stays in Supabase Auth. Keep the application profile's
-- display copy synchronized only after Auth commits an email change.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.profiles
    set email = lower(new.email)
    where id = new.id;
  end if;
  return new;
end
$$;

revoke all on function public.sync_profile_email() from public;

create trigger on_auth_user_email_updated
after update of email on auth.users
for each row execute function public.sync_profile_email();
