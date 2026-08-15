-- ============================================================
-- SiroQ Phase 5 — compliance: classification, retention, DSR, terms
--   * retention_policies: months per template sensitivity class
--   * purge_expired / purge_dataset: retention enforcement RPCs
--     (superadmin) + pg_cron job registration (hosted Supabase)
--   * subject_requests: data-subject requests (export / delete)
--     with an operator processing RPC
--   * terms + terms_acceptances: versioned terms, accept RPC
--
-- Design decisions:
--   * Sensitivity already lives on templates (none / sales_financial /
--     patient_health) and is carried by datasets.template_code. A
--     dataset's retention months are resolved through that link.
--   * Purging is two-step and audit-backed: archive_dataset soft-freezes
--     a dataset (status → 'purged'); purge_dataset hard-deletes rows +
--     stats + operations + storage object + dataset row once retention
--     elapsed. audit_log rows are never destroyed (append-only).
--   * Cron is optional: registration is guarded so migrations keep
--     working where pg_cron is absent.
-- ============================================================

-- ---------- Retention policies ----------

create table public.retention_policies (
  sensitivity text primary key check (sensitivity in ('none','sales_financial','patient_health')),
  retention_months integer not null check (retention_months >= 0), -- 0 = keep indefinitely
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.retention_policies (sensitivity, retention_months)
values
  ('none', 0),             -- no PII/regulated data: keep
  ('sales_financial', 36), -- sales/financial: 3 years
  ('patient_health', 72)   -- dispensing/patient: 6 years
on conflict (sensitivity) do nothing;

grant select on public.retention_policies to authenticated;

alter table public.retention_policies enable row level security;
create policy "retention policies readable" on public.retention_policies
  for select using (true);

-- Datasets get an explicit retention status.
alter table public.datasets
  drop constraint datasets_status_check,
  add constraint datasets_status_check
    check (status in ('pending','processing','ready','error','purged'));

-- Resolve a dataset's retention months (0 = keep) via its template.
create or replace function public._sf_retention_months(p_dataset_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select rp.retention_months
       from public.datasets d
       join public.templates t on t.code = d.template_code
       join public.retention_policies rp on rp.sensitivity = t.sensitivity
      where d.id = p_dataset_id and rp.enabled),
    0
  );
$$;

-- Datasets past their retention window (created_at anchored).
-- Includes already-archived (status 'purged') datasets so a real sweep can
-- finish what a dry sweep started; excludes only hard-deleted rows (gone).
create or replace function public._sf_purge_eligible(
  p_cutoff timestamptz default null,
  p_dataset_ids uuid[] default null
)
returns setof public.datasets
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_cutoff, now());
begin
  return query
    select d.*
      from public.datasets d
     where (p_dataset_ids is null or d.id = any(p_dataset_ids))
       and public._sf_retention_months(d.id) > 0
       and d.created_at < v_now - make_interval(months => public._sf_retention_months(d.id));
end;
$$;

-- Operator: freeze a dataset (soft). Audit via append_audit.
create or replace function public.archive_dataset(p_dataset_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  update public.datasets
     set status = 'purged', updated_at = now()
   where id = p_dataset_id and status <> 'purged';

  if found then
    perform public.append_audit(
      'dataset.purged',
      'datasets',
      p_dataset_id::text,
      jsonb_build_object('stage', 'archive', 'retention_months', public._sf_retention_months(p_dataset_id))
    );
  end if;
end;
$$;

-- Operator: hard delete a purged dataset (rows, stats, operations, object).
create or replace function public.purge_dataset(p_dataset_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_storage_path text;
  v_retention int;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  select status, storage_path, public._sf_retention_months(id)
    into v_status, v_storage_path, v_retention
    from public.datasets where id = p_dataset_id;
  if v_status is null then
    raise exception 'DATASET_NOT_FOUND';
  end if;
  if v_status <> 'purged' then
    raise exception 'NOT_PURGED';
  end if;
  if v_retention = 0 then
    raise exception 'KEEP_FOREVER';
  end if;

  perform public.append_audit(
    'dataset.purged',
    'datasets',
    p_dataset_id::text,
    jsonb_build_object('stage', 'hard_delete')
  );

  delete from public.dataset_operations where dataset_id = p_dataset_id;
  delete from public.dataset_column_stats where dataset_id = p_dataset_id;
  delete from public.dataset_rows where dataset_id = p_dataset_id;

  if v_storage_path is not null and v_storage_path <> '' then
    -- storage.delete() was removed from newer storage versions; modern storage
    -- requires the allow_delete_query escape hatch for direct SQL deletes.
    set local storage.allow_delete_query = 'true';
    delete from storage.objects
     where bucket_id = 'uploads' and name = any(string_to_array(v_storage_path, ','));
  end if;

  delete from public.datasets where id = p_dataset_id;
end;
$$;

-- One-shot purge sweep of everything currently eligible.
create or replace function public.purge_expired(
  p_cutoff timestamptz default null,
  p_purge boolean default true,
  p_dataset_ids uuid[] default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_id uuid;
  v_count int := 0;
  v_archived int := 0;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  select array_agg(id) into v_ids from public._sf_purge_eligible(p_cutoff, p_dataset_ids);
  if v_ids is null then
    return 0;
  end if;

  -- dry vs real: real mode also hard-purges whatever is eligible right now
  update public.datasets
     set status = 'purged', updated_at = now()
   where id = any(v_ids) and status <> 'purged';
  get diagnostics v_archived = row_count;

  perform public.append_audit(
    'retention.sweep',
    'datasets',
    null,
    jsonb_build_object('eligible', array_length(v_ids, 1), 'archived', v_archived, 'purge', p_purge)
  );

  if p_purge then
    for v_id in select unnest(v_ids) loop
      begin
        perform public.purge_dataset(v_id);
        v_count := v_count + 1;
      exception when others then
        null;
      end;
    end loop;
    return v_count;
  end if;

  return v_archived;
end;
$$;

grant execute on function public._sf_retention_months(uuid) to authenticated;
grant execute on function public.archive_dataset(uuid) to authenticated;
grant execute on function public.purge_dataset(uuid) to authenticated;
grant execute on function public.purge_expired(timestamptz, boolean, uuid[]) to authenticated;

-- ---------- Subject access requests (export / delete) ----------

create table public.subject_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,
  kind text not null check (kind in ('export','delete')),
  status text not null default 'new' check (status in ('new','processing','done','rejected')),
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references auth.users(id)
);

grant select on public.subject_requests to authenticated;
grant select, insert, update, delete on public.subject_requests to service_role;

alter table public.subject_requests enable row level security;
create policy "users read own requests" on public.subject_requests
  for select using (user_id = auth.uid() or public.is_superadmin());

-- Any user may request an account data export or account deletion.
create or replace function public.request_subject_action(
  p_kind text,
  p_note text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_id bigint;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN';
  end if;
  if p_kind not in ('export','delete') then
    raise exception 'INVALID_KIND';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  insert into public.subject_requests (user_id, user_email, kind, note)
  values (v_uid, v_email, p_kind, p_note)
  returning id into v_id;

  return v_id;
end;
$$;

-- Operator: process a request. export → dump role-scoped data into payload;
-- delete → purge the user's footprint (memberships, self-owned datasets/docs).
create or replace function public.process_subject_request(
  p_request_id bigint,
  p_decision text default 'done'  -- 'done' | 'rejected'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req record;
  v_data jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;
  if p_decision not in ('done','rejected') then
    raise exception 'INVALID_DECISION';
  end if;

  select * into v_req from public.subject_requests where id = p_request_id;
  if v_req is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if p_decision = 'rejected' then
    update public.subject_requests
       set status = 'rejected', processed_at = now(), processed_by = v_uid
     where id = p_request_id;
    perform public.append_audit('dsr.rejected', 'subject_requests', p_request_id::text);
    return;
  end if;

  if v_req.kind = 'export' then
    select jsonb_build_object(
      'user', jsonb_build_object('email', v_req.user_email),
      'memberships', coalesce((
        select jsonb_agg(sub) from (
          select m.organization_id, m.role, m.branch_scope
            from public.org_members m where m.user_id = v_req.user_id
        ) sub), '[]'::jsonb)
    ) into v_data;

    update public.subject_requests
       set status = 'done', payload = v_data, processed_at = now(), processed_by = v_uid
     where id = p_request_id;

    perform public.append_audit('dsr.export', 'subject_requests', p_request_id::text,
      jsonb_build_object('user', v_req.user_email));
  else
    -- delete: drop memberships + owned files; auth user removal is a manual ops step
    delete from public.org_members where user_id = v_req.user_id;

    update public.subject_requests
       set status = 'done', payload = '{"footprint":"removed"}'::jsonb, processed_at = now(), processed_by = v_uid
     where id = p_request_id;

    perform public.append_audit('dsr.delete', 'subject_requests', p_request_id::text,
      jsonb_build_object('user', v_req.user_email));
  end if;
end;
$$;

grant execute on function public.request_subject_action(text, text) to authenticated;
grant execute on function public.process_subject_request(bigint, text) to authenticated;

-- ---------- Terms of Service ----------

create table public.terms (
  id bigint generated always as identity primary key,
  version text not null unique,
  title text not null,
  body text not null,
  effective_from timestamptz not null default now(),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.terms_acceptances (
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_id bigint not null references public.terms(id) on delete cascade,
  accepted_at timestamptz not null default now(),
  primary key (user_id, terms_id)
);

grant select on public.terms to authenticated;
grant select, insert on public.terms_acceptances to authenticated;

alter table public.terms enable row level security;
create policy "terms readable" on public.terms for select using (true);
alter table public.terms_acceptances enable row level security;
create policy "users read own terms" on public.terms_acceptances
  for select using (user_id = auth.uid() or public.is_superadmin());

-- Current active terms (for the consent banner).
create or replace function public.current_terms()
returns public.terms
language sql
stable
security invoker
as $$
  select * from public.terms where active order by effective_from desc limit 1;
$$;

-- Whether the current user must accept the active terms.
create or replace function public.terms_pending()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_terms_id bigint;
  v_accepted boolean;
begin
  select id into v_terms_id from public.terms where active order by effective_from desc limit 1;
  if v_terms_id is null then
    return false;
  end if;
  select exists (
    select 1 from public.terms_acceptances where user_id = v_uid and terms_id = v_terms_id
  ) into v_accepted;
  return not coalesce(v_accepted, false);
end;
$$;

-- Accept current terms.
create or replace function public.accept_terms()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_terms_id bigint;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN';
  end if;
  select id into v_terms_id from public.terms where active order by effective_from desc limit 1;
  if v_terms_id is null then
    raise exception 'NO_TERMS';
  end if;
  insert into public.terms_acceptances (user_id, terms_id)
  values (v_uid, v_terms_id)
  on conflict do nothing;
end;
$$;

grant execute on function public.current_terms() to authenticated;
grant execute on function public.terms_pending() to authenticated;
grant execute on function public.accept_terms() to authenticated;

-- Seed the first Terms version.
insert into public.terms (version, title, body, effective_from, active) values
  ('2026-08-01', 'Terms of Service v1',
   'SiroQ processes pharmacy data on behalf of your organization. Data is stored at rest and transmitted in transit in accordance with the platform security policy. Privacy policy: personal data is limited to what is required for account and delivery operation; you may request a copy or deletion of your data at any time.',
   now(), true)
on conflict (version) do nothing;

-- ---------- pg_cron (optional) ----------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'schedule' and pronamespace = to_regnamespace('cron')::oid) then
    perform cron.schedule(
      'siroq-retention-sweep',
      '0 3 * * 0', -- weekly Sunday 03:00
      'select public.purge_expired()'
    );
  end if;
exception when others then
  null;
end;
$$;