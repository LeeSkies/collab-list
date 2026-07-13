begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

select has_table('public', 'products', 'products exists');
select has_table('public', 'product_pick_history', 'history exists');
select has_table('public', 'profiles', 'profiles exists');
select col_type_is('public', 'products', 'quantity', 'numeric(5,2)', 'quantity is exact numeric');
select col_is_pk('public', 'products', 'id', 'product id is primary key');
select fk_ok('public', 'product_pick_history', 'product_id', 'public', 'products', 'id', 'history references products');
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
select is((select count(*)::integer from public.product_pick_history h join public.products p on p.id=h.product_id where p.name='Test apples'), 1, 'pick appends exactly one history event');
select is((select picked_by_email from public.product_pick_history h join public.products p on p.id=h.product_id where p.name='Test apples'), 'admin@example.com', 'history snapshots the actor email');
select throws_ok($$ select public.toggle_product_picked((select id from public.products where name='Test apples'), 1, false) $$, '40001', 'product_conflict', 'stale pick is rejected');

set local role anon;
select throws_ok(
  $$ select count(*) from public.products $$,
  '42501',
  'permission denied for table products',
  'anonymous users cannot read products'
);

select * from finish();
rollback;
