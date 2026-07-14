alter table public.profiles add column name text;

update public.profiles
set name = initcap(regexp_replace(split_part(email, '@', 1), '[._-]+', ' ', 'g'));

alter table public.profiles
  alter column name set not null,
  add constraint profiles_name_length check (char_length(name) between 1 and 80),
  add constraint profiles_name_trimmed check (name = btrim(name));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text := btrim(coalesce(new.raw_user_meta_data ->> 'name', ''));
begin
  if profile_name = '' then
    profile_name := initcap(regexp_replace(split_part(new.email, '@', 1), '[._-]+', ' ', 'g'));
  end if;
  if char_length(profile_name) > 80 then
    raise exception using errcode = '22023', message = 'invalid_profile_name';
  end if;

  insert into public.profiles(id, email, name, role)
  values (
    new.id,
    lower(new.email),
    profile_name,
    case when not exists (select 1 from public.profiles where role = 'admin')
      then 'admin'
      else 'member'
    end
  );
  return new;
end
$$;
