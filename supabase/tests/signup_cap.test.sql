begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth, pg_catalog;
select plan(5);

set local role postgres;
select is(
  (select enabled from public.feature_flags where key = 'temporary_signup_cap'),
  true,
  'the temporary signup cap is enabled by default'
);

-- Fill the fixture database to one slot below the cap. The test is independent
-- of the number of users in the local seed and rolls back with the test.
do $$
declare
  template_user auth.users;
  next_id uuid;
  next_number integer := 1;
begin
  select * into template_user from auth.users order by created_at, id limit 1;

  while (select count(*) from auth.users) < 19 loop
    next_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change_token, reauthentication_token,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      template_user.instance_id, next_id, template_user.aud, template_user.role,
      format('signup-cap-%s@example.com', next_number), template_user.encrypted_password,
      now(), template_user.confirmation_token, template_user.recovery_token,
      template_user.email_change_token_new, template_user.email_change,
      template_user.email_change_token_current, template_user.phone_change_token,
      template_user.reauthentication_token, template_user.raw_app_meta_data,
      '{"name":"Signup Cap Fixture"}'::jsonb, now(), now()
    );
    next_number := next_number + 1;
  end loop;
end
$$;

select is(
  (select count(*) from auth.users),
  19::bigint,
  'the fixture reaches one account below the cap'
);

select lives_ok(
  $$ insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at
     ) values (
       (select instance_id from auth.users limit 1), gen_random_uuid(), 'authenticated',
       'authenticated', 'signup-cap-final@example.com', crypt('password123', gen_salt('bf')),
       now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Final Signup"}'::jsonb, now(), now()
     ) $$,
  'the twentieth account is allowed'
);

select throws_ok(
  $$ insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at
     ) values (
       (select instance_id from auth.users limit 1), gen_random_uuid(), 'authenticated',
       'authenticated', 'signup-cap-overflow@example.com', crypt('password123', gen_salt('bf')),
       now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Overflow Signup"}'::jsonb, now(), now()
     ) $$,
  'P0001',
  'signup_limit_reached',
  'the twenty-first account is rejected'
);

update public.feature_flags
set enabled = false
where key = 'temporary_signup_cap';

select lives_ok(
  $$ insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at
     ) values (
       (select instance_id from auth.users limit 1), gen_random_uuid(), 'authenticated',
       'authenticated', 'signup-cap-disabled@example.com', crypt('password123', gen_salt('bf')),
       now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Disabled Cap Signup"}'::jsonb, now(), now()
     ) $$,
  'disabling the feature flag reopens signups'
);

select * from finish();
rollback;
