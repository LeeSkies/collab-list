begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select has_table('public', 'product_changes', 'product change history exists');
select col_is_pk('public', 'product_changes', 'id', 'events have a stable key');
select has_column('public', 'product_changes', 'changes', 'events include structured changes');
select hasnt_column('public', 'product_changes', 'actor_name', 'events do not store actor names');

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select public.create_product('Product change audit test') $$,
  'product creation succeeds with the audit trigger'
);
select is(
  (select change_type from public.product_changes
   where product_id = (select id from public.products where name = 'Product change audit test')),
  'created',
  'creation is recorded'
);
select is(
  (select actor_id from public.product_changes
   where product_id = (select id from public.products where name = 'Product change audit test')),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'creation records the actor ID'
);
select is(
  (select changes #>> '{name,after}' from public.product_changes
   where product_id = (select id from public.products where name = 'Product change audit test')),
  'Product change audit test',
  'creation records the product name in the JSON diff'
);

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select lives_ok(
  $$ select public.adjust_product_quantity(
    (select id from public.products where name = 'Product change audit test'), 1,
    (select version from public.products where name = 'Product change audit test')
  ) $$,
  'another member can change quantity'
);
select is(
  (select change_type from public.product_changes
   where product_id = (select id from public.products where name = 'Product change audit test')
   order by id desc limit 1),
  'quantity_changed',
  'quantity edits have a specific type'
);
select is(
  (select changes #> '{quantity,before}' from public.product_changes
   where product_id = (select id from public.products where name = 'Product change audit test')
   order by id desc limit 1),
  to_jsonb(1::numeric),
  'quantity diff includes the previous value'
);
select is(
  (select actor_id from public.product_changes
   where product_id = (select id from public.products where name = 'Product change audit test')
   order by id desc limit 1),
  '10000000-0000-0000-0000-000000000002'::uuid,
  'quantity edit records the second member'
);
select lives_ok(
  $$ select public.toggle_product_picked(
    (select id from public.products where name = 'Product change audit test'),
    (select version from public.products where name = 'Product change audit test'), false
  ) $$,
  'picking a product records a change'
);
select is(
  (select change_type from public.product_changes
   where product_id = (select id from public.products where name = 'Product change audit test')
   order by id desc limit 1),
  'picked',
  'pick events have a specific type'
);
select is(
  (select changes #> '{is_picked,before}' from public.product_changes
   where product_id = (select id from public.products where name = 'Product change audit test')
   order by id desc limit 1),
  'false'::jsonb,
  'pick diff records the old state'
);
select throws_ok(
  $$ insert into public.product_changes
     (household_id, product_id, product_version, change_type, changes)
     values ((select household_id from public.products where name = 'Product change audit test'),
             gen_random_uuid(), 1, 'created', '{}'::jsonb) $$,
  '42501', null,
  'clients cannot forge history rows'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000099';
select is(
  (select count(*) from public.product_changes),
  0::bigint,
  'nonmembers cannot see a household history'
);

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
do $$
declare
  product_uuid uuid := (select id from public.products where name = 'Product change audit test');
  next_version bigint;
begin
  for i in 1..31 loop
    select version into next_version from public.products where id = product_uuid;
    perform public.adjust_product_quantity(product_uuid, 1, next_version);
  end loop;
end
$$;
select is(
  (select count(*) from public.product_changes
   where product_id = (select id from public.products where name = 'Product change audit test')),
  30::bigint,
  'only the newest 30 events remain for one product'
);
select is(
  (select min(product_version) from public.product_changes
   where product_id = (select id from public.products where name = 'Product change audit test')),
  5::bigint,
  'pruning removes the oldest versions'
);
select lives_ok(
  $$ select public.delete_product(
    (select id from public.products where name = 'Product change audit test'),
    (select version from public.products where name = 'Product change audit test')
  ) $$,
  'deletion succeeds with the audit trigger'
);
select is(
  (select change_type from public.product_changes
   where changes #>> '{name,before}' = 'Product change audit test'
   order by id desc limit 1),
  'deleted',
  'delete history survives removal of the product row'
);

select * from finish();
rollback;
