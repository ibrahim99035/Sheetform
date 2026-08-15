-- ============================================================
-- SiroQ Phase 2 — org workflow
--   * templates + template_columns (typed, role-mapped analysis)
--   * branch_profiles + branch licensing (pharmacies are branches)
--   * branch status lifecycle (pending/active/rejected/suspended)
--   * submit_application extended with template_code + license gate
--   * notifications table + helpers
--
-- Design decisions:
--   * Branch status derives from review: submit_branch_profile flips the
--     branch back to 'pending'; approve_pharmacy/reject_pharmacy set
--     'active'/'rejected'. Data submissions require an active branch with
--     an unexpired license in branch_profiles.
--   * template_columns carry a canonical "role" (product/qty/unit_price/
--     cost/date/...) so the Phase 3 KPI layer can compute metrics from any
--     conforming template. Storage keys in datasets.column_defs use the
--     template's canonical keys, so KPIs only need column-def lookup.
--   * Templates are a read-only catalog for authenticated users (no user
--     data); RLS select-only.
-- ============================================================

-- ---------- Templates ----------

create table public.templates (
  code text primary key,
  name text not null,
  description text,
  type text not null check (type in ('product','sales','financial','health')),
  sensitivity text not null default 'sales_financial'
    check (sensitivity in ('none','sales_financial','patient_health')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.template_columns (
  template_code text not null references public.templates(code) on delete cascade,
  key text not null,
  label text not null,
  type text not null default 'string' check (type in ('string','numeric','date','boolean')),
  required boolean not null default false,
  role text,
  created_at timestamptz not null default now(),
  primary key (template_code, key)
);

grant select on public.templates to authenticated;
grant select on public.template_columns to authenticated;

alter table public.templates enable row level security;
alter table public.template_columns enable row level security;
create policy "templates readable by authenticated" on public.templates
  for select using (true);
create policy "template columns readable by authenticated" on public.template_columns
  for select using (true);

-- Seed catalog (4 analysis templates)
insert into public.templates (code, name, description, type, sensitivity)
values
  ('sales', 'Monthly sales', 'Per-transaction sales: products sold, quantities, prices, costs.', 'sales', 'sales_financial'),
  ('product', 'Inventory / product', 'Product catalogue with units in stock, unit cost and price.', 'product', 'sales_financial'),
  ('financial', 'Financial statement', 'Revenue / expense lines with category and date.', 'financial', 'sales_financial'),
  ('health', 'Dispensing / patient', 'Dispensing records keyed to a patient identifier.', 'health', 'patient_health')
on conflict (code) do nothing;

insert into public.template_columns (template_code, key, label, type, required, role) values
  ('sales', 'date',          'Date',             'date',    true,  'date'),
  ('sales', 'branch',        'Branch',           'string',  false, 'branch'),
  ('sales', 'transaction_id','Transaction ID',   'string',  false, 'transaction_id'),
  ('sales', 'product',       'Product',          'string',  true,  'product'),
  ('sales', 'category',      'Category',         'string',  false, 'category'),
  ('sales', 'qty',           'Quantity',         'numeric', true,  'qty'),
  ('sales', 'unit_price',    'Unit price',       'numeric', true,  'unit_price'),
  ('sales', 'cost',          'Unit cost',        'numeric', false, 'cost'),
  ('sales', 'refund',        'Refund',           'numeric', false, 'refund'),
  ('product', 'product',     'Product',          'string',  true,  'product'),
  ('product', 'category',    'Category',         'string',  false, 'category'),
  ('product', 'sku',         'SKU',              'string',  false, 'sku'),
  ('product', 'stock_qty',   'Units in stock',   'numeric', false, 'qty'),
  ('product', 'unit_cost',   'Unit cost',        'numeric', false, 'cost'),
  ('product', 'unit_price',  'Unit price',       'numeric', false, 'unit_price'),
  ('financial', 'date',      'Date',             'date',    true,  'date'),
  ('financial', 'branch',    'Branch',           'string',  false, 'branch'),
  ('financial', 'category',  'Category',         'string',  false, 'category'),
  ('financial', 'account',   'Account',          'string',  false, 'account'),
  ('financial', 'revenue',   'Revenue',          'numeric', false, 'revenue'),
  ('financial', 'expense',   'Expense',          'numeric', false, 'expense'),
  ('financial', 'tax',       'Tax',              'numeric', false, 'tax'),
  ('health', 'patient_id',   'Patient ID',       'string',  true,  'patient'),
  ('health', 'date',         'Date',             'date',    true,  'date'),
  ('health', 'product',      'Product',          'string',  true,  'product'),
  ('health', 'qty',          'Quantity',         'numeric', true,  'qty'),
  ('health', 'unit_price',   'Unit price',       'numeric', true,  'unit_price'),
  ('health', 'cost',         'Unit cost',        'numeric', false, 'cost')
on conflict (template_code, key) do nothing;

-- ---------- Branch status + profiles ----------

alter table public.branches
  add column status text not null default 'pending'
    check (status in ('pending','active','rejected','suspended'));

create table public.branch_profiles (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pharmacy_name text not null,
  address text,
  phone text,
  license_no text not null,
  license_expiry date not null,
  delivery_email text,
  whatsapp text,
  email_delivery boolean not null default false,
  whatsapp_delivery boolean not null default false,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  rejection_reason text,
  updated_at timestamptz not null default now(),
  unique (organization_id, branch_id)
);

grant select, insert, update on public.branch_profiles to authenticated;
grant select, insert, update on public.branch_profiles to service_role;

alter table public.branch_profiles enable row level security;
create policy "org members read branch profiles" on public.branch_profiles
  for select using (
    public._sf_is_org_member(organization_id) or public.is_superadmin()
  );
create policy "org managers write branch profiles" on public.branch_profiles
  for all using (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  )
  with check (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  );

-- branches: owners/managers/superadmins manage status + profile state.
create policy "org managers update branch" on public.branches
  for update using (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  );

-- ---------- Branch workflow RPCs ----------

create or replace function public.submit_branch_profile(
  p_org_id uuid,
  p_branch_id uuid,
  p_pharmacy_name text,
  p_license_no text,
  p_license_expiry date,
  p_address text default null,
  p_phone text default null,
  p_delivery_email text default null,
  p_whatsapp text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.org_members
    where organization_id = p_org_id and user_id = auth.uid() and role in ('owner','manager')
  ) and not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  if not exists (
    select 1 from public.branches where id = p_branch_id and organization_id = p_org_id
  ) then
    raise exception 'BRANCH_NOT_FOUND';
  end if;

  if p_pharmacy_name is null or btrim(p_pharmacy_name) = '' or p_license_no is null
     or btrim(p_license_no) = '' then
    raise exception 'INVALID_PROFILE';
  end if;
  if p_license_expiry < current_date then
    raise exception 'LICENSE_EXPIRED';
  end if;

  insert into public.branch_profiles
    (branch_id, organization_id, pharmacy_name, license_no, license_expiry, address, phone, delivery_email, whatsapp)
  values
    (p_branch_id, p_org_id, btrim(p_pharmacy_name), btrim(p_license_no), p_license_expiry, p_address, p_phone, p_delivery_email, p_whatsapp)
  on conflict (branch_id) do update set
    pharmacy_name = excluded.pharmacy_name,
    license_no = excluded.license_no,
    license_expiry = excluded.license_expiry,
    address = excluded.address,
    phone = excluded.phone,
    delivery_email = excluded.delivery_email,
    whatsapp = excluded.whatsapp,
    reviewed_at = null,
    reviewed_by = null,
    rejection_reason = null,
    updated_at = now();

  update public.branches
  set status = 'pending', updated_at = now()
  where id = p_branch_id and status in ('pending','rejected','suspended');
end;
$$;

create or replace function public.approve_pharmacy(p_org_id uuid, p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lic date;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  select license_expiry into v_lic
  from public.branch_profiles where branch_id = p_branch_id and organization_id = p_org_id;
  if v_lic is null then
    raise exception 'PROFILE_MISSING';
  end if;
  if v_lic < current_date then
    raise exception 'LICENSE_EXPIRED';
  end if;

  update public.branch_profiles
  set reviewed_at = now(), reviewed_by = auth.uid(), rejection_reason = null, updated_at = now()
  where branch_id = p_branch_id and organization_id = p_org_id;

  update public.branches
  set status = 'active', updated_at = now()
  where id = p_branch_id and organization_id = p_org_id;
end;
$$;

create or replace function public.reject_pharmacy(
  p_org_id uuid,
  p_branch_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  update public.branch_profiles
  set reviewed_at = now(), reviewed_by = auth.uid(), rejection_reason = p_reason, updated_at = now()
  where branch_id = p_branch_id and organization_id = p_org_id;

  update public.branches
  set status = 'rejected', updated_at = now()
  where id = p_branch_id and organization_id = p_org_id;
end;
$$;

-- ---------- datasets: template link ----------

alter table public.datasets
  add column template_code text references public.templates(code);

-- ---------- submit_application (extended) ----------

drop function if exists public.submit_application(uuid, text, text, text, jsonb, uuid, text, text);

create or replace function public.submit_application(
  p_org_id uuid,
  p_title text,
  p_original_filename text,
  p_storage_path text,
  p_column_defs jsonb default '[]'::jsonb,
  p_branch_id uuid default null,
  p_sheet_name text default null,
  p_note text default null,
  p_template_code text default null
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
  v_branch_status text;
  v_lic date;
  v_template_active boolean;
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

  if p_template_code is not null then
    select active into v_template_active from public.templates where code = p_template_code;
    if v_template_active is not true then
      raise exception 'TEMPLATE_NOT_FOUND';
    end if;
  end if;

  if p_branch_id is not null then
    if not exists (select 1 from public.branches where id = p_branch_id and organization_id = p_org_id) then
      raise exception 'INVALID_BRANCH';
    end if;
    if v_role = 'pharmacist' and not (p_branch_id = any(v_scope)) then
      raise exception 'FORBIDDEN';
    end if;

    select b.status, bp.license_expiry into v_branch_status, v_lic
    from public.branches b
    left join public.branch_profiles bp on bp.branch_id = b.id and bp.organization_id = b.organization_id
    where b.id = p_branch_id and b.organization_id = p_org_id;

    if v_branch_status is distinct from 'active' then
      raise exception 'BRANCH_NOT_ACTIVE';
    end if;
    if v_lic is null or v_lic < current_date then
      raise exception 'LICENSE_EXPIRED';
    end if;
  else
    if v_role = 'pharmacist' then
      raise exception 'BRANCH_REQUIRED';
    end if;
  end if;

  insert into public.datasets (owner_id, name, original_filename, storage_path, status, column_defs, sheet_name, template_code)
  values (v_uid, btrim(p_title), p_original_filename, p_storage_path, 'pending', coalesce(p_column_defs, '[]'), p_sheet_name, p_template_code)
  returning id into v_dataset_id;

  insert into public.applications (organization_id, branch_id, submitted_by, title, note)
  values (p_org_id, p_branch_id, v_uid, btrim(p_title), p_note)
  returning id into v_app_id;

  insert into public.application_files (application_id, dataset_id, original_filename, storage_path, sheet_name, column_defs)
  values (v_app_id, v_dataset_id, p_original_filename, p_storage_path, p_sheet_name, coalesce(p_column_defs, '[]'));

  return query select v_app_id, v_dataset_id;
end;
$$;

grant execute on function public.submit_application(uuid, text, text, text, jsonb, uuid, text, text, text) to authenticated;
grant execute on function public.submit_branch_profile(uuid, uuid, text, text, date, text, text, text, text) to authenticated;
grant execute on function public.approve_pharmacy(uuid, uuid) to authenticated;
grant execute on function public.reject_pharmacy(uuid, uuid, text) to authenticated;

-- ---------- Notifications ----------

create table public.notifications (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_notifications_user on public.notifications(user_id, read_at, created_at desc);

grant select, insert, update on public.notifications to service_role;
grant select, update on public.notifications to authenticated;

alter table public.notifications enable row level security;
create policy "user reads own notifications" on public.notifications
  for select using (user_id = auth.uid() or public.is_superadmin());
create policy "user marks own notifications read" on public.notifications
  for update using (user_id = auth.uid() or public.is_superadmin());

-- Single write path (avoids granting insert to authenticated).
create or replace function public.notify_user(
  p_user_ids uuid[],
  p_kind text,
  p_title text,
  p_body text default null,
  p_payload jsonb default '{}'::jsonb,
  p_org_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_ids is null or cardinality(p_user_ids) = 0 then
    return;
  end if;
  insert into public.notifications (organization_id, user_id, kind, title, body, payload)
  select p_org_id, x, p_kind, p_title, p_body, coalesce(p_payload, '{}'::jsonb)
  from unnest(p_user_ids) x;
end;
$$;

grant execute on function public.notify_user(uuid[], text, text, text, jsonb, uuid) to service_role;

-- Applications ready/error notify the submitter and org owners/managers.
create or replace function public._notify_application_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_title text;
  v_body text;
begin
  if new.status in ('ready','error') and new.status <> coalesce(old.status, '') then
    v_kind := new.status;
    v_title := case when new.status = 'ready' then 'Data application processed'
                    else 'Data application failed' end;
    v_body := case when new.status = 'ready' then concat(new.title, ' is ready for analysis.')
                   else concat(new.title, ' failed to import. Please retry or contact support.') end;

    perform public.notify_user(
      array(select user_id from public.org_members
            where organization_id = new.organization_id and role in ('owner','manager'))
        || array[new.submitted_by],
      v_kind, v_title, v_body,
      jsonb_build_object('application_id', new.id), new.organization_id
    );
  end if;
  return new;
end;
$$;

create trigger trg_notify_application_status
  after update of status on public.applications
  for each row execute function public._notify_application_status();

-- Organization approval notifies the creator.
create or replace function public._notify_org_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    perform public.notify_user(
      array[new.created_by], 'org_approved', 'Organization approved',
      concat(new.name, ' is now active. You can manage branches and submit data.'),
      jsonb_build_object('organization_id', new.id), new.id
    );
  end if;
  return new;
end;
$$;

create trigger trg_notify_org_active
  after update of status on public.organizations
  for each row execute function public._notify_org_active();

-- Report publish / revoke notifies all org members.
create or replace function public._notify_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    perform public.notify_user(
      array(select user_id from public.org_members where organization_id = new.organization_id),
      'report_published', 'New report available', concat('A report on ', new.title, ' has been published.'),
      jsonb_build_object('report_id', new.id), new.organization_id
    );
  elsif new.status = 'revoked' and old.status is distinct from 'revoked' then
    perform public.notify_user(
      array(select user_id from public.org_members where organization_id = new.organization_id),
      'report_revoked', 'Report revoked', concat('The report ', new.title, ' has been revoked.'),
      jsonb_build_object('report_id', new.id), new.organization_id
    );
  end if;
  return new;
end;
$$;

create trigger trg_notify_report
  after update of status on public.reports
  for each row execute function public._notify_report();

alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.templates;
alter publication supabase_realtime add table public.branch_profiles;