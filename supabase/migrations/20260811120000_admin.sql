-- ============================================================
-- Superadmin: role table, helper function, RLS extensions, admin RPCs
-- ============================================================

-- ---------- admin_users table ----------

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.admin_users to authenticated, service_role;

alter table public.admin_users enable row level security;

drop policy if exists "admin reads own row" on public.admin_users;
create policy "admin reads own row" on public.admin_users
  for select using (user_id = auth.uid());

drop policy if exists "admin updates own row" on public.admin_users;
create policy "admin updates own row" on public.admin_users
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Elevation/deletion is only possible with the service role (scripts/add-admin.mjs).
-- No insert/delete RLS policies exist for authenticated users.

-- ---------- is_superadmin() ----------

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

grant execute on function public.is_superadmin() to authenticated;

-- ---------- Extend owner RLS with superadmin ----------
-- All app DB functions are SECURITY INVOKER and lean on RLS, so extending the
-- owner policies is enough to give superadmins full control of any dataset.

drop policy if exists "owner full access" on public.datasets;
create policy "owner full access" on public.datasets
  for all using (owner_id = auth.uid() or public.is_superadmin())
  with check (owner_id = auth.uid() or public.is_superadmin());

drop policy if exists "owner via dataset" on public.dataset_rows;
create policy "owner via dataset" on public.dataset_rows
  for all using (
    dataset_id in (select id from public.datasets where owner_id = auth.uid())
    or public.is_superadmin()
  );

drop policy if exists "owner via dataset" on public.dataset_column_stats;
create policy "owner via dataset" on public.dataset_column_stats
  for all using (
    dataset_id in (select id from public.datasets where owner_id = auth.uid())
    or public.is_superadmin()
  );

drop policy if exists "owner via dataset" on public.dataset_operations;
create policy "owner via dataset" on public.dataset_operations
  for all using (
    dataset_id in (select id from public.datasets where owner_id = auth.uid())
    or public.is_superadmin()
  );

-- Storage: superadmins may reach any user's uploaded originals.
drop policy if exists "uploads read own" on storage.objects;
create policy "uploads read own" on storage.objects
  for select using (
    bucket_id = 'uploads'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_superadmin())
  );

drop policy if exists "uploads insert own" on storage.objects;
create policy "uploads insert own" on storage.objects
  for insert with check (
    bucket_id = 'uploads'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_superadmin())
  );

drop policy if exists "uploads update own" on storage.objects;
create policy "uploads update own" on storage.objects
  for update using (
    bucket_id = 'uploads'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_superadmin())
  );

drop policy if exists "uploads delete own" on storage.objects;
create policy "uploads delete own" on storage.objects
  for delete using (
    bucket_id = 'uploads'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_superadmin())
  );

-- ---------- Admin RPCs ----------

create or replace function public.admin_list_users()
returns table (user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, dataset_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;
  return query
    select
      u.id as user_id,
      u.email::text as email,
      u.created_at,
      u.last_sign_in_at,
      (select count(*)::bigint from public.datasets d where d.owner_id = u.id) as dataset_count
    from auth.users u
    order by u.created_at desc;
end;
$$;

create or replace function public.admin_list_datasets(p_user_id uuid)
returns table (id uuid, name text, status text, row_count integer, sheet_name text, created_at timestamptz, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;
  return query
    select d.id, d.name, d.status, d.row_count, d.sheet_name, d.created_at, d.updated_at
    from public.datasets d
    where d.owner_id = p_user_id
    order by d.updated_at desc;
end;
$$;

grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_list_datasets(uuid) to authenticated;