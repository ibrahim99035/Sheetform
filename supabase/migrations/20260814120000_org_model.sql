-- ============================================================
-- SiroQ organization model
-- Organizations, profiles, branches, members, applications,
-- reports, report access control — plus the cutover of
-- dataset-table RLS to superadmin-only.
--
-- Design decisions (restrictive/secure options chosen, per plan):
--   * One org per user. create_owner / create_pharmacist reject a
--     user who already belongs to any organization.
--   * branch_scope is uuid[] (a pharmacist may be scoped to several
--     branches). Every element is validated against the org's branches
--     (RPC guard + a BEFORE trigger for defense in depth).
--   * Composite FK (organization_id, branch_id) -> branches(organization_id, id)
--     on applications and reports, so a branch reference can never point
--     at another org's branch. branch_id is nullable = org-wide.
--   * Orphan-row treatment: submitted applications whose datasets fail
--     import are NEVER auto-deleted — the dataset keeps its error_message
--     so the operator can see/retry it, and applications.status mirrors
--     datasets.status via a trigger. Deleting a branch that is referenced
--     by a member scope, application, or report is blocked instead of
--     silently leaving dangling references — enforced via RLS from
--     migration 20260814130000_org_fix.sql (a FIRST-version trigger was
--     replaced because it also blocked org cascade deletes).
--   * Report publishing: only a superadmin (operator) publishes; the org
--     must be active; a report requires at least one component or item;
--     every linked application must belong to the org. revise_report
--     replaces the report's content in place and bumps revised_at (no
--     version history — deliberately simple, more restrictive).
--   * Pharmacists may only submit applications for a branch inside their
--     own branch_scope; restricted report items are never visible to them.
--   * License: submit_org_profile and approve_organization both require
--     license_expiry >= current_date.
-- ============================================================

-- ---------- Tables ----------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'pending'
    check (status in ('pending','active','suspended','rejected')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.org_profile (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  pharmacy_name text not null,
  address text,
  phone text,
  license_no text not null,
  license_expiry date not null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  rejection_reason text,
  updated_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id) -- target for composite FKs
);

create table public.org_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer'
    check (role in ('owner','manager','pharmacist','viewer')),
  branch_scope uuid[] not null default '{}', -- empty = org-wide (owners/managers)
  is_primary_owner boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid, -- null = org-wide submission
  submitted_by uuid not null references auth.users(id) on delete restrict,
  title text not null,
  note text,
  status text not null default 'submitted'
    check (status in ('submitted','processing','ready','error','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id)
);

create table public.application_files (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  original_filename text not null,
  storage_path text not null,
  sheet_name text,
  column_defs jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (application_id, dataset_id)
);

create index idx_application_files_dataset_id on public.application_files(dataset_id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,
  title text not null,
  summary text,
  status text not null default 'draft'
    check (status in ('draft','published','revoked')),
  created_by uuid not null references auth.users(id),
  published_at timestamptz,
  revised_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id)
);

create table public.report_components (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text','chart','table','insight')),
  title text,
  body jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index idx_report_components_report_id on public.report_components(report_id, sort_order);

create table public.report_applications (
  report_id uuid not null references public.reports(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, application_id)
);

-- Deliverable insight lines with per-item access gating:
--   org       -> visible to every member of the org
--   branch    -> visible to members whose branch_scope intersects branch_ids
--   restricted-> owners/managers/superadmin only (never pharmacists)
create table public.report_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  component_id uuid references public.report_components(id) on delete set null,
  visibility text not null default 'org'
    check (visibility in ('org','branch','restricted')),
  branch_ids uuid[] not null default '{}',
  title text,
  body jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index idx_report_items_report_id on public.report_items(report_id, sort_order);

-- ---------- Grants ----------

grant select, insert, update, delete on public.organizations to authenticated, service_role;
grant select, insert, update, delete on public.org_profile to authenticated, service_role;
grant select, insert, update, delete on public.branches to authenticated, service_role;
grant select, insert, update, delete on public.org_members to authenticated, service_role;
grant select, insert, update, delete on public.applications to authenticated, service_role;
grant select, insert, update, delete on public.application_files to authenticated, service_role;
grant select, insert, update, delete on public.reports to authenticated, service_role;
grant select, insert, update, delete on public.report_components to authenticated, service_role;
grant select, insert, update, delete on public.report_applications to authenticated, service_role;
grant select, insert, update, delete on public.report_items to authenticated, service_role;

-- ---------- Helper functions ----------

-- All branch ids in p_branch_ids must belong to the given organization.
create or replace function public._sf_validate_branch_scope(p_org_id uuid, p_branch_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_branch_ids is null
    or cardinality(p_branch_ids) = 0
    or (
      select count(*) = cardinality(p_branch_ids)
      from unnest(p_branch_ids) b
      where exists (
        select 1 from public.branches br
        where br.id = b and br.organization_id = p_org_id
      )
    );
$$;

-- Defense in depth: keep branch_scope consistent even for direct inserts.
create or replace function public._sf_validate_org_members_branch_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.branch_scope is not null and not public._sf_validate_branch_scope(new.organization_id, new.branch_scope) then
    raise exception 'INVALID_BRANCH_SCOPE';
  end if;
  return new;
end;
$$;

create trigger trg_org_members_branch_scope
  before insert or update of branch_scope on public.org_members
  for each row execute function public._sf_validate_org_members_branch_scope();

-- Block deleting a branch that is still referenced (orphan treatment).
create or replace function public._sf_protect_branch_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.org_members m
    where m.organization_id = old.organization_id and old.id = any(m.branch_scope)
  ) or exists (
    select 1 from public.applications a where a.branch_id = old.id
  ) or exists (
    select 1 from public.reports r where r.branch_id = old.id
  ) or exists (
    select 1 from public.report_items i where old.id = any(i.branch_ids)
  ) then
    raise exception 'BRANCH_IN_USE';
  end if;
  return old;
end;
$$;

create trigger trg_protect_branch_refs
  before delete on public.branches
  for each row execute function public._sf_protect_branch_refs();

-- Whether the current user is a member of the given organization.
-- SECURITY DEFINER (reads org_members explicitly) so it can be used safely
-- from RLS policies on other org tables without recursion or RLS coupling.
create or replace function public._sf_is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members m
    where m.organization_id = p_org_id and m.user_id = auth.uid()
  );
$$;

-- Whether the current user is an owner/manager of the given organization.
create or replace function public._sf_is_org_manager(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members m
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.role in ('owner','manager')
  );
$$;

-- Keep applications.status in sync with the import pipeline's dataset status.
-- SECURITY DEFINER because it writes applications (which have no user-facing
-- update policy) on behalf of the datasets update. Internal-only: calling it
-- directly (no trigger row) is rejected.
create or replace function public._sf_sync_application_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op is null then
    raise exception 'FORBIDDEN';
  end if;
  update public.applications a
  set status = case new.status
        when 'ready' then 'ready'
        when 'error' then 'error'
        when 'processing' then 'processing'
        else 'submitted'
      end,
      updated_at = now()
  where a.id in (select f.application_id from public.application_files f where f.dataset_id = new.id);
  return new;
end;
$$;

create trigger trg_sync_application_status
  after update of status on public.datasets
  for each row execute function public._sf_sync_application_status();

-- Whether the current user may read the given report / report item.
-- SECURITY DEFINER: reads reports + org_members explicitly to avoid
-- relying on their own RLS policies (no recursion).
create or replace function public.effective_report_access(
  p_report_id uuid,
  p_visibility text default 'org',
  p_branch_ids uuid[] default '{}'::uuid[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_role text;
  v_scope uuid[];
  v_status text;
begin
  if public.is_superadmin() then
    return true;
  end if;

  select r.organization_id, r.status into v_org, v_status
  from public.reports r
  where r.id = p_report_id;

  if v_org is null then
    return false;
  end if;

  select m.role, coalesce(m.branch_scope, '{}'::uuid[]) into v_role, v_scope
  from public.org_members m
  where m.organization_id = v_org and m.user_id = auth.uid();

  if v_role is null then
    return false; -- not a member
  end if;

  if v_role in ('owner','manager') then
    return true;
  end if;

  -- Pharmacists only ever see published reports, and never restricted items.
  if v_status <> 'published' then
    return false;
  end if;

  if p_visibility = 'org' then
    return true;
  end if;

  if p_visibility = 'branch' then
    return exists (
      select 1 from unnest(coalesce(p_branch_ids, '{}'::uuid[])) b
      where b = any(v_scope)
    );
  end if;

  return false; -- 'restricted'
end;
$$;

-- ---------- RLS ----------

alter table public.organizations enable row level security;
create policy "org members read" on public.organizations
  for select using (
    public._sf_is_org_member(id)
    or public.is_superadmin()
  );
create policy "org owners update" on public.organizations
  for update using (
    public._sf_is_org_manager(id)
    or public.is_superadmin()
  );

alter table public.org_profile enable row level security;
create policy "org members read profile" on public.org_profile
  for select using (
    public._sf_is_org_member(organization_id)
    or public.is_superadmin()
  );
create policy "org owners write profile" on public.org_profile
  for all using (
    public._sf_is_org_manager(organization_id)
    or public.is_superadmin()
  )
  with check (
    public._sf_is_org_manager(organization_id)
    or public.is_superadmin()
  );

alter table public.branches enable row level security;
create policy "org members read branches" on public.branches
  for select using (
    public._sf_is_org_member(organization_id)
    or public.is_superadmin()
  );
create policy "org owners manage branches" on public.branches
  for all using (
    public._sf_is_org_manager(organization_id)
    or public.is_superadmin()
  )
  with check (
    public._sf_is_org_manager(organization_id)
    or public.is_superadmin()
  );

alter table public.org_members enable row level security;
-- A member sees only their own row; owners/managers/superadmins see the roster.
create policy "members read own membership" on public.org_members
  for select using (
    user_id = auth.uid()
    or public._sf_is_org_manager(organization_id)
    or public.is_superadmin()
  );
-- Writes happen exclusively through the SECURITY DEFINER RPCs
-- (create_owner, create_pharmacist, set_pharmacist_access).

alter table public.applications enable row level security;
create policy "org members read applications" on public.applications
  for select using (
    public._sf_is_org_member(organization_id)
    or public.is_superadmin()
  );
-- Writes happen exclusively through submit_application (SECURITY DEFINER);
-- status changes flow in from the datasets trigger.

alter table public.application_files enable row level security;
create policy "org members read files" on public.application_files
  for select using (
    public._sf_is_org_member(
      (select a.organization_id from public.applications a where a.id = application_id)
    )
    or public.is_superadmin()
  );

alter table public.reports enable row level security;
create policy "read by effective access" on public.reports
  for select using (public.effective_report_access(id));
-- Writes happen exclusively through publish_report / revise_report.

alter table public.report_components enable row level security;
create policy "read via report" on public.report_components
  for select using (
    report_id in (select r.id from public.reports r where public.effective_report_access(r.id))
  );

alter table public.report_applications enable row level security;
create policy "read via report" on public.report_applications
  for select using (
    report_id in (select r.id from public.reports r where public.effective_report_access(r.id))
  );

alter table public.report_items enable row level security;
create policy "read by effective access" on public.report_items
  for select using (
    public.effective_report_access(report_id, visibility, branch_ids)
  );

-- ---------- Dataset RLS cutover: superadmin-only ----------
-- The operator (superadmin) is now the only role that reads/writes dataset
-- tables directly; org users interact with data through applications and
-- reports. The import webhook runs as service_role (RLS bypassed). Regular
-- users' old /datasets pages go dark here; Phase 3 rewires them to
-- applications.

drop policy if exists "owner full access" on public.datasets;
create policy "admin full access" on public.datasets
  for all using (public.is_superadmin())
  with check (public.is_superadmin());

drop policy if exists "owner via dataset" on public.dataset_rows;
create policy "admin via dataset" on public.dataset_rows
  for all using (
    dataset_id in (select id from public.datasets)
    and public.is_superadmin()
  );

drop policy if exists "owner via dataset" on public.dataset_column_stats;
create policy "admin via dataset" on public.dataset_column_stats
  for all using (
    dataset_id in (select id from public.datasets)
    and public.is_superadmin()
  );

drop policy if exists "owner via dataset" on public.dataset_operations;
create policy "admin via dataset" on public.dataset_operations
  for all using (
    dataset_id in (select id from public.datasets)
    and public.is_superadmin()
  );

-- ---------- RPCs (SECURITY DEFINER; each self-guards) ----------

-- A freshly signed-up user claims a new organization as its primary owner.
create or replace function public.create_owner(p_org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN';
  end if;
  if p_org_name is null or btrim(p_org_name) = '' then
    raise exception 'INVALID_ORG_NAME';
  end if;
  -- One org per user (restrictive).
  if exists (select 1 from public.org_members where user_id = v_uid) then
    raise exception 'ALREADY_MEMBER';
  end if;

  insert into public.organizations (name, created_by)
  values (btrim(p_org_name), v_uid)
  returning id into v_org_id;

  insert into public.org_members (organization_id, user_id, role, is_primary_owner)
  values (v_org_id, v_uid, 'owner', true);

  return v_org_id;
end;
$$;

-- Owner/manager submits the org profile for review (or resubmits after rejection).
create or replace function public.submit_org_profile(
  p_org_id uuid,
  p_pharmacy_name text,
  p_license_no text,
  p_license_expiry date,
  p_address text default null,
  p_phone text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if not exists (
    select 1 from public.org_members
    where organization_id = p_org_id and user_id = v_uid and role in ('owner','manager')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_status from public.organizations where id = p_org_id;
  if v_status is null then
    raise exception 'ORG_NOT_FOUND';
  end if;
  if v_status = 'suspended' then
    raise exception 'ORG_SUSPENDED';
  end if;

  if p_pharmacy_name is null or btrim(p_pharmacy_name) = '' or p_license_no is null
     or btrim(p_license_no) = '' then
    raise exception 'INVALID_PROFILE';
  end if;
  if p_license_expiry < current_date then
    raise exception 'LICENSE_EXPIRED';
  end if;

  insert into public.org_profile (organization_id, pharmacy_name, license_no, license_expiry, address, phone)
  values (p_org_id, btrim(p_pharmacy_name), btrim(p_license_no), p_license_expiry, p_address, p_phone)
  on conflict (organization_id) do update set
    pharmacy_name = excluded.pharmacy_name,
    license_no = excluded.license_no,
    license_expiry = excluded.license_expiry,
    address = excluded.address,
    phone = excluded.phone,
    reviewed_at = null,
    reviewed_by = null,
    rejection_reason = null,
    updated_at = now();

  -- Reopen review for pending/rejected orgs.
  update public.organizations
  set status = 'pending', updated_at = now()
  where id = p_org_id and status in ('pending','rejected');
end;
$$;

create or replace function public.approve_organization(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_lic_exp date;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_status from public.organizations where id = p_org_id;
  if v_status is null then
    raise exception 'ORG_NOT_FOUND';
  end if;
  if v_status = 'active' then
    return; -- idempotent
  end if;

  select license_expiry into v_lic_exp from public.org_profile where organization_id = p_org_id;
  if v_lic_exp is null then
    raise exception 'PROFILE_MISSING';
  end if;
  if v_lic_exp < current_date then
    raise exception 'LICENSE_EXPIRED';
  end if;

  update public.org_profile
  set reviewed_at = now(), reviewed_by = auth.uid(), rejection_reason = null, updated_at = now()
  where organization_id = p_org_id;

  update public.organizations
  set status = 'active', updated_at = now()
  where id = p_org_id;
end;
$$;

create or replace function public.reject_organization(p_org_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  update public.org_profile
  set reviewed_at = now(), reviewed_by = auth.uid(), rejection_reason = p_reason, updated_at = now()
  where organization_id = p_org_id;

  update public.organizations
  set status = 'rejected', updated_at = now()
  where id = p_org_id;
end;
$$;

-- Attach an existing auth user to the org as a pharmacist.
-- The auth user itself is created by the app layer via the Supabase Admin
-- API (strong random username+password returned once, never stored in
-- plaintext); this RPC receives the resulting user_id.
create or replace function public.create_pharmacist(
  p_org_id uuid,
  p_user_id uuid,
  p_branch_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  select role into v_role from public.org_members
  where organization_id = p_org_id and user_id = v_uid;

  if v_role is null or v_role not in ('owner','manager') then
    if not public.is_superadmin() then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'USER_NOT_FOUND';
  end if;

  -- One org per user.
  if exists (select 1 from public.org_members where user_id = p_user_id) then
    raise exception 'ALREADY_MEMBER';
  end if;

  if not public._sf_validate_branch_scope(p_org_id, p_branch_ids) then
    raise exception 'INVALID_BRANCH_SCOPE';
  end if;

  insert into public.org_members (organization_id, user_id, role, branch_scope)
  values (p_org_id, p_user_id, 'pharmacist', coalesce(p_branch_ids, '{}'::uuid[]));
end;
$$;

-- Owner/manager narrows or widens a pharmacist's branch scope.
create or replace function public.set_pharmacist_access(
  p_org_id uuid,
  p_user_id uuid,
  p_branch_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  select role into v_role from public.org_members
  where organization_id = p_org_id and user_id = v_uid;

  if v_role is null or v_role not in ('owner','manager') then
    if not public.is_superadmin() then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  if not exists (
    select 1 from public.org_members
    where organization_id = p_org_id and user_id = p_user_id and role = 'pharmacist'
  ) then
    raise exception 'TARGET_NOT_PHARMACIST';
  end if;

  if not public._sf_validate_branch_scope(p_org_id, p_branch_ids) then
    raise exception 'INVALID_BRANCH_SCOPE';
  end if;

  update public.org_members
  set branch_scope = coalesce(p_branch_ids, '{}'::uuid[])
  where organization_id = p_org_id and user_id = p_user_id;
end;
$$;

-- Member submits a data application: creates a pending dataset (the import
-- webhook picks it up), an application record, and the file link.
create or replace function public.submit_application(
  p_org_id uuid,
  p_title text,
  p_original_filename text,
  p_storage_path text,
  p_column_defs jsonb default '[]'::jsonb,
  p_branch_id uuid default null,
  p_sheet_name text default null,
  p_note text default null
)
returns table (application_id uuid, dataset_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_scope uuid[];
  v_status text;
  v_app_id uuid;
  v_dataset_id uuid;
begin
  select m.role, coalesce(m.branch_scope, '{}'::uuid[]) into v_role, v_scope
  from public.org_members m
  where m.organization_id = p_org_id and m.user_id = v_uid;

  if v_role is null or v_role not in ('owner','manager','pharmacist') then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_status from public.organizations where id = p_org_id;
  if v_status is distinct from 'active' then
    raise exception 'ORG_NOT_ACTIVE';
  end if;

  if p_title is null or btrim(p_title) = '' or p_original_filename is null
     or p_storage_path is null then
    raise exception 'INVALID_APPLICATION';
  end if;

  if p_branch_id is not null then
    if not exists (select 1 from public.branches where id = p_branch_id and organization_id = p_org_id) then
      raise exception 'INVALID_BRANCH';
    end if;
    -- Pharmacists may only submit for a branch inside their own scope.
    if v_role = 'pharmacist' and not (p_branch_id = any(v_scope)) then
      raise exception 'FORBIDDEN';
    end if;
  else
    -- Pharmacists must scope submissions to one of their branches.
    if v_role = 'pharmacist' then
      raise exception 'BRANCH_REQUIRED';
    end if;
  end if;

  insert into public.datasets (owner_id, name, original_filename, storage_path, status, column_defs, sheet_name)
  values (v_uid, btrim(p_title), p_original_filename, p_storage_path, 'pending', coalesce(p_column_defs, '[]'), p_sheet_name)
  returning id into v_dataset_id;

  insert into public.applications (organization_id, branch_id, submitted_by, title, note)
  values (p_org_id, p_branch_id, v_uid, btrim(p_title), p_note)
  returning id into v_app_id;

  insert into public.application_files (application_id, dataset_id, original_filename, storage_path, sheet_name, column_defs)
  values (v_app_id, v_dataset_id, p_original_filename, p_storage_path, p_sheet_name, coalesce(p_column_defs, '[]'));

  return query select v_app_id, v_dataset_id;
end;
$$;

-- Operator publishes a report: components + access-gated items + source apps.
create or replace function public.publish_report(
  p_org_id uuid,
  p_title text,
  p_summary text default null,
  p_components jsonb default '[]'::jsonb,
  p_items jsonb default '[]'::jsonb,
  p_application_ids uuid[] default null,
  p_branch_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_cnt int;
  v_report_id uuid;
  v_comp jsonb;
  v_item jsonb;
  v_vis text;
  v_branches uuid[];
  v_sort int;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_status from public.organizations where id = p_org_id;
  if v_status is distinct from 'active' then
    raise exception 'ORG_NOT_ACTIVE';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'INVALID_REPORT';
  end if;
  if jsonb_array_length(coalesce(p_components, '[]'::jsonb)) = 0
     and jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'EMPTY_REPORT';
  end if;

  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and organization_id = p_org_id
  ) then
    raise exception 'INVALID_BRANCH';
  end if;

  if p_application_ids is not null and cardinality(p_application_ids) > 0 then
    select count(*) into v_cnt from public.applications a
    where a.id = any(p_application_ids) and a.organization_id = p_org_id;
    if v_cnt <> cardinality(p_application_ids) then
      raise exception 'INVALID_APPLICATION';
    end if;
  end if;

  -- Validate item visibility + branch scopes up front.
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_vis := v_item->>'visibility';
    if v_vis is null or v_vis not in ('org','branch','restricted') then
      raise exception 'INVALID_ITEM_VISIBILITY';
    end if;
    v_branches := coalesce(
      (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_item->'branch_ids', '[]'::jsonb)) x),
      '{}'::uuid[]
    );
    if not public._sf_validate_branch_scope(p_org_id, v_branches) then
      raise exception 'INVALID_BRANCH_SCOPE';
    end if;
  end loop;

  insert into public.reports (organization_id, branch_id, title, summary, status, created_by, published_at)
  values (p_org_id, p_branch_id, btrim(p_title), p_summary, 'published', v_uid, now())
  returning id into v_report_id;

  v_sort := 0;
  for v_comp in select * from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) loop
    insert into public.report_components (report_id, kind, title, body, sort_order)
    values (
      v_report_id,
      coalesce(v_comp->>'kind', 'text'),
      v_comp->>'title',
      v_comp->'body',
      v_sort
    );
    v_sort := v_sort + 1;
  end loop;

  v_sort := 0;
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_branches := coalesce(
      (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_item->'branch_ids', '[]'::jsonb)) x),
      '{}'::uuid[]
    );
    insert into public.report_items (report_id, visibility, branch_ids, title, body, sort_order)
    values (v_report_id, v_item->>'visibility', v_branches, v_item->>'title', v_item->'body', v_sort);
    v_sort := v_sort + 1;
  end loop;

  if p_application_ids is not null and cardinality(p_application_ids) > 0 then
    insert into public.report_applications (report_id, application_id)
    select v_report_id, x from unnest(p_application_ids) x;
  end if;

  return v_report_id;
end;
$$;

-- Operator revises an existing published report in place (new revised_at).
create or replace function public.revise_report(
  p_report_id uuid,
  p_title text,
  p_summary text default null,
  p_components jsonb default '[]'::jsonb,
  p_items jsonb default '[]'::jsonb,
  p_application_ids uuid[] default null,
  p_branch_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_status text;
  v_cnt int;
  v_comp jsonb;
  v_item jsonb;
  v_vis text;
  v_branches uuid[];
  v_sort int;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  select organization_id, status into v_org, v_status from public.reports where id = p_report_id;
  if v_org is null then
    raise exception 'REPORT_NOT_FOUND';
  end if;
  select status into v_status from public.organizations where id = v_org;
  if v_status is distinct from 'active' then
    raise exception 'ORG_NOT_ACTIVE';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'INVALID_REPORT';
  end if;
  if jsonb_array_length(coalesce(p_components, '[]'::jsonb)) = 0
     and jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'EMPTY_REPORT';
  end if;

  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and organization_id = v_org
  ) then
    raise exception 'INVALID_BRANCH';
  end if;

  if p_application_ids is not null and cardinality(p_application_ids) > 0 then
    select count(*) into v_cnt from public.applications a
    where a.id = any(p_application_ids) and a.organization_id = v_org;
    if v_cnt <> cardinality(p_application_ids) then
      raise exception 'INVALID_APPLICATION';
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_vis := v_item->>'visibility';
    if v_vis is null or v_vis not in ('org','branch','restricted') then
      raise exception 'INVALID_ITEM_VISIBILITY';
    end if;
    v_branches := coalesce(
      (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_item->'branch_ids', '[]'::jsonb)) x),
      '{}'::uuid[]
    );
    if not public._sf_validate_branch_scope(v_org, v_branches) then
      raise exception 'INVALID_BRANCH_SCOPE';
    end if;
  end loop;

  delete from public.report_components where report_id = p_report_id;
  delete from public.report_items where report_id = p_report_id;
  delete from public.report_applications where report_id = p_report_id;

  update public.reports
  set title = btrim(p_title),
      summary = p_summary,
      branch_id = p_branch_id,
      revised_at = now(),
      updated_at = now()
  where id = p_report_id;

  v_sort := 0;
  for v_comp in select * from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) loop
    insert into public.report_components (report_id, kind, title, body, sort_order)
    values (p_report_id, coalesce(v_comp->>'kind', 'text'), v_comp->>'title', v_comp->'body', v_sort);
    v_sort := v_sort + 1;
  end loop;

  v_sort := 0;
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_branches := coalesce(
      (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_item->'branch_ids', '[]'::jsonb)) x),
      '{}'::uuid[]
    );
    insert into public.report_items (report_id, visibility, branch_ids, title, body, sort_order)
    values (p_report_id, v_item->>'visibility', v_branches, v_item->>'title', v_item->'body', v_sort);
    v_sort := v_sort + 1;
  end loop;

  if p_application_ids is not null and cardinality(p_application_ids) > 0 then
    insert into public.report_applications (report_id, application_id)
    select p_report_id, x from unnest(p_application_ids) x;
  end if;

  return p_report_id;
end;
$$;

-- ---------- Function grants ----------

grant execute on function public._sf_validate_branch_scope(uuid, uuid[]) to authenticated;
grant execute on function public._sf_is_org_member(uuid) to authenticated;
grant execute on function public._sf_is_org_manager(uuid) to authenticated;
grant execute on function public.effective_report_access(uuid, text, uuid[]) to authenticated;
grant execute on function public.create_owner(text) to authenticated;
grant execute on function public.submit_org_profile(uuid, text, text, date, text, text) to authenticated;
grant execute on function public.approve_organization(uuid) to authenticated;
grant execute on function public.reject_organization(uuid, text) to authenticated;
grant execute on function public.create_pharmacist(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.set_pharmacist_access(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.submit_application(uuid, text, text, text, jsonb, uuid, text, text) to authenticated;
grant execute on function public.publish_report(uuid, text, text, jsonb, jsonb, uuid[], uuid) to authenticated;
grant execute on function public.revise_report(uuid, text, text, jsonb, jsonb, uuid[], uuid) to authenticated;

-- ---------- Realtime ----------

alter publication supabase_realtime add table public.organizations;
alter publication supabase_realtime add table public.applications;
alter publication supabase_realtime add table public.reports;
