begin;

-- Categories become household-mutable. All writes go through security-definer
-- RPCs scoped to the caller's household so the table itself keeps select-only
-- grants, RLS, and the exact three-column schema (id, household_id, name).

create or replace function public.create_category(p_name text)
returns setof public.categories
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_household uuid := public.require_household_membership();
  trimmed_name text := coalesce(btrim(p_name), '');
begin
  perform public.require_household_mutation_access(current_household);

  if char_length(trimmed_name) < 1 or char_length(trimmed_name) > 80 then
    raise exception using errcode = '22023', message = 'invalid_category_name';
  end if;

  return query
  insert into public.categories(household_id, name)
  values (current_household, trimmed_name)
  returning *;
end
$$;

-- Deleting a category is admin-only and destructive: the household's products
-- are atomically reassigned to `other` before the category row goes away, so
-- the composite product foreign key stays valid. `other` itself can never be
-- deleted because it is the reassignment target and the quick-create default.
create or replace function public.delete_category(p_category_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_household uuid := public.require_household_membership();
  deleted_category_id uuid;
  deleted_category_name text;
  default_category_id uuid;
begin
  perform public.require_household_mutation_access(current_household);

  if not exists (
    select 1
    from public.household_members as membership
    where membership.household_id = current_household
      and membership.user_id = auth.uid()
      and membership.role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;

  select category.id, category.name
  into deleted_category_id, deleted_category_name
  from public.categories as category
  where category.id = p_category_id
    and category.household_id = current_household;

  if deleted_category_id is null then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;

  if deleted_category_name = 'other' then
    raise exception using errcode = 'P0001', message = 'cannot_delete_other';
  end if;

  select category.id
  into default_category_id
  from public.categories as category
  where category.household_id = current_household
    and category.name = 'other';

  if default_category_id is null then
    raise exception using errcode = 'P0001', message = 'default_category_missing';
  end if;

  update public.products
  set category_id = default_category_id,
      version = version + 1,
      updated_by = auth.uid()
  where household_id = current_household
    and category_id = p_category_id;

  delete from public.categories as category
  where category.id = p_category_id
    and category.household_id = current_household;

  return true;
end
$$;

revoke all on function public.create_category(text) from public;
revoke all on function public.delete_category(uuid) from public;
grant execute on function public.create_category(text) to authenticated;
grant execute on function public.delete_category(uuid) to authenticated;

-- Realtime convergence: other devices need category creates and deletes so
-- their options, grouping, and filters stay in sync. Full replica identity is
-- required for the household-scoped DELETE filter to see the old row's
-- household_id.
alter table public.categories replica identity full;
alter publication supabase_realtime add table public.categories;

commit;
