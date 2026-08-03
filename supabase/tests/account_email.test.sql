begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
set local role postgres;

select has_function('public', 'sync_profile_email', ARRAY[]::text[], 'email synchronization trigger function exists');
select is(
  (select count(*) from pg_trigger
   where tgrelid = 'auth.users'::regclass
     and tgname = 'on_auth_user_email_updated'),
  1::bigint,
  'Auth email updates invoke the profile synchronization trigger'
);
select is(
  (select email from public.profiles where id = '10000000-0000-0000-0000-000000000001'::uuid),
  'admin@example.com',
  'the initial profile email is synchronized'
);

-- A pending Auth change is not an application identity change. This models an
-- abandoned confirmation flow: GoTrue leaves auth.users.email untouched until
-- the confirmation is completed.
update auth.users
set email_change = 'abandoned@example.com', email_change_token_new = 'abandoned-token'
where id = '10000000-0000-0000-0000-000000000001'::uuid;
select is(
  (select email from public.profiles where id = '10000000-0000-0000-0000-000000000001'::uuid),
  'admin@example.com',
  'abandoning a pending change leaves the profile email unchanged'
);
select is(
  (select email from auth.users where id = '10000000-0000-0000-0000-000000000001'::uuid),
  'admin@example.com',
  'abandoning a pending change leaves the Auth email active'
);

-- Only the Auth-owned email column is changed; all application ownership data
-- continues to use the stable UUID.
update auth.users
set email = 'admin-renamed@example.com',
    email_change = '', email_change_token_new = ''
where id = '10000000-0000-0000-0000-000000000001'::uuid;
select is(
  (select email from public.profiles where id = '10000000-0000-0000-0000-000000000001'::uuid),
  'admin-renamed@example.com',
  'confirmed Auth email updates the profile copy'
);
select is(
  (select count(*) from public.household_members where user_id = '10000000-0000-0000-0000-000000000001'::uuid),
  1::bigint,
  'email confirmation preserves the household membership row'
);
select is(
  (select role from public.household_members where user_id = '10000000-0000-0000-0000-000000000001'::uuid),
  'admin',
  'email confirmation preserves the household role'
);
select is(
  (select count(*) from public.products where household_id =
    (select household_id from public.household_members where user_id = '10000000-0000-0000-0000-000000000001'::uuid)),
  3::bigint,
  'email confirmation preserves household products'
);
select is(
  (select id from public.profiles where email = 'admin-renamed@example.com'),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'the profile keeps the stable Auth user ID'
);

select throws_ok(
  $$ update auth.users set email = 'member@example.com'
     where id = '10000000-0000-0000-0000-000000000001'::uuid $$,
  '23505',
  null,
  'duplicate Auth email is rejected without changing the profile'
);
select is(
  (select email from public.profiles where id = '10000000-0000-0000-0000-000000000001'::uuid),
  'admin-renamed@example.com',
  'duplicate email rejection leaves the current profile email intact'
);

-- Browser roles cannot edit profiles or reach auth.users. There is no admin
-- member-email path; the only supported mutation is the signed-in user Auth
-- flow used by the account API wrapper.
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ update public.profiles set email = 'forbidden@example.com' where id = auth.uid() $$,
  '42501',
  null,
  'authenticated members cannot edit profile email directly'
);
select throws_ok(
  $$ select email from auth.users where id = auth.uid() $$,
  '42501',
  null,
  'authenticated members cannot access Auth user rows'
);
select is(
  has_function_privilege('authenticated', 'public.sync_profile_email()', 'execute'),
  false,
  'browser roles cannot invoke the synchronization trigger function'
);

select * from finish();
rollback;
