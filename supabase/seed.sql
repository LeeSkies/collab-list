-- Local-only deterministic accounts. Hosted users must be created through the admin UI.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change_token, email_change_token_current, reauthentication_token, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin@example.com', crypt('password123', gen_salt('bf')), now(), '', '', '', '', '', '', '', '{"provider":"email","providers":["email"]}', '{"name":"Local Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'member@example.com', crypt('password123', gen_salt('bf')), now(), '', '', '', '', '', '', '', '{"provider":"email","providers":["email"]}', '{"name":"Local Member"}', now(), now())
on conflict (id) do nothing;

insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '{"sub":"10000000-0000-0000-0000-000000000001","email":"admin@example.com"}', 'email', 'admin@example.com', now(), now(), now()),
  ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '{"sub":"10000000-0000-0000-0000-000000000002","email":"member@example.com"}', 'email', 'member@example.com', now(), now(), now())
on conflict (provider_id, provider) do nothing;

update public.profiles set role = 'admin' where email = 'admin@example.com';

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select * from public.create_product('Milk');
select * from public.create_product('לחם');
select * from public.create_product('עגבניות');
commit;
