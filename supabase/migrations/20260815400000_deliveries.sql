-- ============================================================
-- SiroQ Phase 4 — report deliveries queue
--   * deliveries (rendered snapshot of a published report sent to
--     a branch's configured address via email and/or WhatsApp)
--   * queue_report_deliveries(report, kind): superadmin/operator
--     queues one delivery row per enabled recipient address from
--     branch_profiles (email_delivery / whatsapp_delivery flags)
--   * retry_deliveries(report): re-queues failed/skipped rows
--
-- Design decisions:
--   * The queue is push-based: worker claims a row (status → processing)
--     and sets delivered/failed/skipped. Statuses:
--       queued → processing → delivered | failed | skipped
--     failed rows carry last_error; skipped rows mean "no provider
--     configured / recipient disabled" (informational, not an outage).
--   * RLS mirrors the operator model: org members may read delivery
--     rows for reports they can see; only service_role and the two
--     operator RPCs write. is_superadmin is checked inside the RPCs.
--   * No foreign key on kind-specific payloads; addresses are
--     denormalized from branch_profiles at queue time so a later
--     profile change cannot silently re-point an already sent email.
-- ============================================================

create table public.deliveries (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.reports(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  kind text not null check (kind in ('email','whatsapp')),
  to_address text not null,
  subject text,
  body jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued','processing','delivered','failed','skipped')),
  attempt_count integer not null default 0,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_deliveries_claim
  on public.deliveries(status, created_at)
  where status in ('queued','processing');
create index idx_deliveries_report on public.deliveries(report_id, kind);

grant select on public.deliveries to authenticated;
grant select, insert, update, delete on public.deliveries to service_role;

alter table public.deliveries enable row level security;
create policy "org members read deliveries" on public.deliveries
  for select using (
    exists (
      select 1 from public.org_members m
      where m.organization_id = deliveries.organization_id
        and m.user_id = auth.uid()
    ) or public.is_superadmin()
  );

-- The operator queues a report for delivery to enabled recipients.
-- p_kind in ('email','whatsapp') or null for both. Recipients are the
-- report's branch (if the report is branch-scoped) or every branch with
-- the matching delivery flag enabled in branch_profiles.
create or replace function public.queue_report_deliveries(
  p_report_id uuid,
  p_kind text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_branch uuid;
  v_status text;
  v_org_status bool;
  v_title text;
  v_inserted int := 0;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;
  if p_kind is not null and p_kind not in ('email','whatsapp') then
    raise exception 'INVALID_KIND';
  end if;

  select r.organization_id, r.branch_id, r.status, r.title,
         o.status = 'active'
    into v_org, v_branch, v_status, v_title, v_org_status
    from public.reports r
    join public.organizations o on o.id = r.organization_id
   where r.id = p_report_id;
  if v_org is null then
    raise exception 'REPORT_NOT_FOUND';
  end if;
  if not v_org_status then
    raise exception 'ORG_NOT_ACTIVE';
  end if;
  if v_status <> 'published' then
    raise exception 'REPORT_NOT_PUBLISHED';
  end if;

  insert into public.deliveries
    (report_id, organization_id, branch_id, kind, to_address, subject)
  select
    p_report_id, bp.organization_id, bp.branch_id,
    x.kind,
    case x.kind when 'email' then bp.delivery_email else bp.whatsapp end,
    v_title
  from public.branch_profiles bp
  cross join (
    select unnest(
      case
        when p_kind is null then array['email','whatsapp']
        else array[p_kind]
      end
    )::text kind
  ) x
  where bp.organization_id = v_org
    and (v_branch is null or bp.branch_id = v_branch)
    and case when x.kind = 'email' then
          bp.email_delivery and bp.delivery_email is not null and btrim(bp.delivery_email) <> ''
        else
          bp.whatsapp_delivery and bp.whatsapp is not null and btrim(bp.whatsapp) <> ''
        end;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- Re-queue failed/skipped delivery rows for a report (idempotent).
create or replace function public.retry_deliveries(p_report_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_cnt int := 0;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;
  select organization_id into v_org from public.reports where id = p_report_id;
  if v_org is null then
    raise exception 'REPORT_NOT_FOUND';
  end if;
  update public.deliveries
     set status = 'queued', last_error = null, updated_at = now()
   where report_id = p_report_id and status in ('failed','skipped');
  get diagnostics v_cnt = row_count;
  return v_cnt;
end;
$$;

grant execute on function public.queue_report_deliveries(uuid, text) to authenticated;
grant execute on function public.retry_deliveries(uuid) to authenticated;