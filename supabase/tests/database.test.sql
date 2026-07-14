begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

select has_table('public', 'products', 'products exists');
select hasnt_table('public', 'product_pick_history', 'history table was removed');
select has_table('public', 'profiles', 'profiles exists');
select has_column('public', 'profiles', 'name', 'profiles have display names');
select col_not_null('public', 'profiles', 'name', 'profile names are required');
select is((select name from public.profiles where email = 'admin@example.com'), 'Local Admin', 'new-user trigger stores the supplied display name');
select throws_ok($$ update public.profiles set name = '' where email = 'admin@example.com' $$, '23514', null, 'blank profile names are rejected');
select col_type_is('public', 'products', 'quantity', 'numeric(5,2)', 'quantity is exact numeric');
select col_is_pk('public', 'products', 'id', 'product id is primary key');
select fk_ok('public', 'products', 'updated_by', 'public', 'profiles', 'id', 'product updater references profiles');
select is(public.product_name_signature('soy milk'), public.product_name_signature('Milk-Soy'), 'unordered case-insensitive tokens collide');
select isnt(public.product_name_signature('milk milk'), public.product_name_signature('milk'), 'token counts remain distinct');
select is(public.normalize_product_name('  חלב   סויה '), 'חלב סויה', 'Hebrew whitespace normalizes');

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select lives_ok($$ select public.create_product('Test apples') $$, 'authenticated user can create through RPC');
select throws_ok($$ select public.create_product('APPLES test') $$, '23505', null, 'database prevents duplicate word signature');
select is((select quantity::text from public.products where name = 'Test apples'), '1.00', 'default quantity is one');
select lives_ok($$ select public.adjust_product_quantity((select id from public.products where name='Test apples'), 1, (select version from public.products where name='Test apples')) $$, 'atomic increment succeeds');
select is((select quantity::text from public.products where name = 'Test apples'), '2.00', 'atomic increment changes by one');
select lives_ok($$ select public.toggle_product_picked((select id from public.products where name='Test apples'), (select version from public.products where name='Test apples'), false) $$, 'conditional pick succeeds');
select is((select updated_by from public.products where name='Test apples'), '10000000-0000-0000-0000-000000000001'::uuid, 'pick stamps the updater');
select isnt((select updated_at from public.products where name='Test apples'), (select created_at from public.products where name='Test apples'), 'product mutation advances updated_at');
select throws_ok($$ select public.toggle_product_picked((select id from public.products where name='Test apples'), 1, false) $$, 'PT409', 'product_conflict', 'stale pick returns a conflict');
select throws_ok($$ select public.adjust_product_quantity((select id from public.products where name='Test apples'), 1, 1) $$, 'PT409', 'product_conflict', 'stale quantity adjustment returns a conflict');
select throws_ok($$ select public.update_product((select id from public.products where name='Test apples'), 'Test apples', '2', '', 1) $$, 'PT409', 'product_conflict', 'stale edit returns a conflict');
select throws_ok($$ select public.delete_product((select id from public.products where name='Test apples'), 1) $$, 'PT409', 'product_conflict', 'stale deletion returns a conflict');

select lives_ok($$ select public.update_product((select id from public.products where name='Test apples'), 'Test apples', '2', 'seasonal', (select version from public.products where name='Test apples')) $$, 'picked product can be prepared for restore options test');
select lives_ok($$ select public.restore_all_products(true, true) $$, 'restore all succeeds');
select is((select is_picked from public.products where name='Test apples'), false, 'restore all restores picked products');
select is((select notes from public.products where name='Test apples'), null, 'restore all can clear notes');
select is((select quantity from public.products where name='Test apples'), 1::numeric, 'restore all can reset quantities');

select lives_ok($$ select public.create_product('Test milk') $$, 'second product created');
select lives_ok($$ select public.update_product((select id from public.products where name='Test milk'), 'Test milk', '3', 'keep cold', (select version from public.products where name='Test milk')) $$, 'second product has custom fields');
select lives_ok($$ select public.toggle_product_picked((select id from public.products where name='Test milk'), (select version from public.products where name='Test milk'), false) $$, 'second product is bought');
select lives_ok($$ select public.restore_all_products(false, false) $$, 'restore all without resets succeeds');
select is((select notes from public.products where name='Test milk'), 'keep cold', 'restore all can preserve notes');
select is((select quantity from public.products where name='Test milk'), 3::numeric, 'restore all can preserve quantities');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select lives_ok($$ select public.adjust_product_quantity((select id from public.products where name='Test milk'), 1, (select version from public.products where name='Test milk')) $$, 'member can update a product');
select is((select updated_by from public.products where name='Test milk'), '10000000-0000-0000-0000-000000000002'::uuid, 'latest mutation stamps the member as updater');

set local role anon;
select throws_ok(
  $$ select count(*) from public.products $$,
  '42501',
  'permission denied for table products',
  'anonymous users cannot read products'
);

select * from finish();
rollback;
