-- Keep a bounded, household-private history for each product. There is no
-- backfill: products that already exist acquire history on their next change.
create table public.product_changes (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  product_id uuid not null,
  product_version bigint not null,
  changed_at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  change_type text not null check (change_type in (
    'created', 'updated', 'quantity_changed', 'picked', 'unpicked', 'deleted'
  )),
  changes jsonb not null check (jsonb_typeof(changes) = 'object')
);

-- product_id deliberately has no products FK: deleting a product must not
-- erase its final event or earlier history.
create index product_changes_product_recent_idx
  on public.product_changes(product_id, changed_at desc, id desc);

create index product_changes_household_recent_idx
  on public.product_changes(household_id, changed_at desc, id desc);

alter table public.product_changes enable row level security;

create policy product_changes_read_member
on public.product_changes for select
to authenticated
using (public.is_household_member(household_id));

revoke all on public.product_changes from public, anon, authenticated;
grant select on public.product_changes to authenticated;

create or replace function public.record_product_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_fields jsonb := '{}'::jsonb;
  after_fields jsonb := '{}'::jsonb;
  field_name text;
  field_changes jsonb := '{}'::jsonb;
  event_type text;
  event_product_id uuid;
  event_household_id uuid;
  event_version bigint;
begin
  if tg_op <> 'INSERT' then
    before_fields := jsonb_build_object(
      'name', old.name,
      'quantity', old.quantity,
      'notes', old.notes,
      'category_id', old.category_id,
      'is_picked', old.is_picked,
      'picked_at', old.picked_at,
      'ordering_at', old.ordering_at
    );
  end if;

  if tg_op <> 'DELETE' then
    after_fields := jsonb_build_object(
      'name', new.name,
      'quantity', new.quantity,
      'notes', new.notes,
      'category_id', new.category_id,
      'is_picked', new.is_picked,
      'picked_at', new.picked_at,
      'ordering_at', new.ordering_at
    );
  end if;

  foreach field_name in array array[
    'name', 'quantity', 'notes', 'category_id', 'is_picked',
    'picked_at', 'ordering_at'
  ] loop
    if before_fields -> field_name is distinct from after_fields -> field_name then
      field_changes := field_changes || jsonb_build_object(
        field_name,
        jsonb_build_object(
          'before', before_fields -> field_name,
          'after', after_fields -> field_name
        )
      );
    end if;
  end loop;

  if tg_op = 'DELETE' then
    event_type := 'deleted';
    event_product_id := old.id;
    event_household_id := old.household_id;
    event_version := old.version;
  else
    event_product_id := new.id;
    event_household_id := new.household_id;
    event_version := new.version;
    if tg_op = 'INSERT' then
      event_type := 'created';
    elsif field_changes ? 'is_picked' then
      event_type := case when new.is_picked then 'picked' else 'unpicked' end;
    elsif field_changes ? 'quantity'
      and not (field_changes ?| array['name', 'notes', 'category_id', 'is_picked']) then
      event_type := 'quantity_changed';
    else
      event_type := 'updated';
    end if;
  end if;

  insert into public.product_changes (
    household_id, product_id, product_version, actor_id, change_type, changes
  ) values (
    event_household_id, event_product_id, event_version, auth.uid(), event_type, field_changes
  );

  -- Product writes serialize on the product row, so concurrent mutations
  -- cannot leave more than 30 committed events for the same product.
  delete from public.product_changes
  where id in (
    select id
    from public.product_changes
    where product_id = event_product_id
    order by changed_at desc, id desc
    offset 30
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

revoke all on function public.record_product_change() from public, anon, authenticated;

create trigger products_record_change
after insert or update or delete on public.products
for each row execute function public.record_product_change();
