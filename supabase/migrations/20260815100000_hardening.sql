-- ============================================================
-- SiroQ production hardening
--   * Append-only audit log for sensitive actions.
--   * retry_import RPC (operator recovery of stuck/failed imports).
--
-- Design decisions:
--   * audit_log is APPEND-ONLY: authenticated users get select only
--     (RLS-scoped) and every write goes through the SECURITY DEFINER
--     append_audit(...) helper, so the recorded actor is always
--     auth.uid() and can't be forged. No update/delete grants exist
--     for end users; service_role may write for system events.
--   * Triggers record dataset status changes, application status
--     changes, report publishes/revisions/revocations, and org-profile
--     reviews. They run SECURITY DEFINER so the import webhook
--     (service_role) and RPC-driven changes are all captured.
--   * retry_import is superadmin-only and merely resets the dataset to
--     'pending'; re-invocation is driven by the operator UI, which
--     calls the import Edge Function with the webhook secret.
-- ============================================================

-- ---------- Append-only audit log ----------

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_log_created on public.audit_log(created_at desc);
create index idx_audit_log_actor on public.audit_log(actor_id);
create index idx_audit_log_org on public.audit_log(organization_id);
create index idx_audit_log_entity on public.audit_log(entity_type, entity_id);

grant select, insert on public.audit_log to service_role;
grant select on public.audit_log to authenticated;

alter table public.audit_log enable row level security;

create policy "audit read by operator or org member" on public.audit_log
  for select using (
    public.is_superadmin()
    or (organization_id is not null and public._sf_is_org_member(organization_id))
  );

-- Single write path: records the acting auth.uid() and returns the row id.
create or replace function public.append_audit(
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_org_id uuid default null
)
returns bigint
language sql
security definer
set search_path = public
as $$
  insert into public.audit_log (actor_id, organization_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), p_org_id, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
  returning id;
$$;

grant execute on function public.append_audit(text, text, text, jsonb, uuid) to authenticated;

-- ---------- Audit triggers ----------

create or replace function public._audit_dataset_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.status, '') is distinct from coalesce(new.status, '') then
    perform public.append_audit(
      'dataset_status',
      'datasets',
      new.id::text,
      jsonb_build_object('from', old.status, 'to', new.status, 'error_message', new.error_message, 'row_count', new.row_count)
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_dataset_status
  after update of status on public.datasets
  for each row execute function public._audit_dataset_status();

create or replace function public._audit_application_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.status, '') is distinct from coalesce(new.status, '') then
    perform public.append_audit(
      'application_status',
      'applications',
      new.id::text,
      jsonb_build_object('from', old.status, 'to', new.status),
      new.organization_id
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_application_status
  after update of status on public.applications
  for each row execute function public._audit_application_status();

create or replace function public._audit_report_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or coalesce(old.status, '') is distinct from coalesce(new.status, '')
     or coalesce(old.revised_at) is distinct from coalesce(new.revised_at)
  then
    perform public.append_audit(
      case when tg_op = 'INSERT' then 'report_published'
           when new.status = 'revoked' then 'report_revoked'
           else 'report_changed' end,
      'reports',
      new.id::text,
      jsonb_build_object('title', new.title, 'status', new.status, 'revised', new.revised_at is not null),
      new.organization_id
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_report_change
  after insert or update of status, revised_at on public.reports
  for each row execute function public._audit_report_change();

create or replace function public._audit_org_profile_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reviewed_at is not null then
    perform public.append_audit(
      'org_review',
      'org_profile',
      new.organization_id::text,
      jsonb_build_object('reviewed_by', new.reviewed_by, 'rejection_reason', new.rejection_reason)
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_org_profile_review
  after insert or update of reviewed_at on public.org_profile
  for each row execute function public._audit_org_profile_review();

-- ---------- retry_import ----------

-- Operator-only recovery: reset a stuck/failed dataset to 'pending' so the
-- import pipeline will process it again. The operator UI re-invokes the
-- Edge Function after this RPC; a new webhook is not required.
create or replace function public.retry_import(p_dataset_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_status from public.datasets where id = p_dataset_id;
  if v_status is null then
    raise exception 'DATASET_NOT_FOUND';
  end if;
  if v_status not in ('pending', 'error') then
    raise exception 'DATASET_NOT_RETRYABLE';
  end if;

  update public.datasets
  set status = 'pending', error_message = null, updated_at = now()
  where id = p_dataset_id;
end;
$$;

grant execute on function public.retry_import(uuid) to authenticated;