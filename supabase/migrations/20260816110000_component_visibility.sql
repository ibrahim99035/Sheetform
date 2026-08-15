-- Per-component access control on reports.
--
-- Until now only `report_items` (insight lines) could be gated
-- (org / branch / restricted). `report_components` (KPI snapshots, charts,
-- tables, prose) were readable by anyone who could read the report, so a
-- pharmacist could see every chart/insight of a published report.
--
-- This migration gives `report_components` the same visibility model as
-- `report_items`, so the operator can mark a component "full access" (org),
-- "branch-scoped", or "exclusive" (restricted). The RLS policy on
-- report_components now resolves access per row via effective_report_access,
-- which means pharmacists only see components the owner chose to make
-- visible to them, while owners/managers/superadmins see everything.

alter table public.report_components
  add column visibility text not null default 'org'
    check (visibility in ('org','branch','restricted')),
  add column branch_ids uuid[] not null default '{}';

drop policy if exists "read via report" on public.report_components;
create policy "read by effective access" on public.report_components
  for select using (
    public.effective_report_access(report_id, visibility, branch_ids)
  );

-- ---------- publish_report / revise_report: component visibility ----------

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

  -- Validate component visibility + branch scopes up front.
  for v_comp in select * from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) loop
    v_vis := coalesce(v_comp->>'visibility', 'org');
    if v_vis not in ('org','branch','restricted') then
      raise exception 'INVALID_COMPONENT_VISIBILITY';
    end if;
    v_branches := coalesce(
      (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_comp->'branch_ids', '[]'::jsonb)) x),
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
    v_branches := coalesce(
      (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_comp->'branch_ids', '[]'::jsonb)) x),
      '{}'::uuid[]
    );
    insert into public.report_components (report_id, kind, title, body, visibility, branch_ids, sort_order)
    values (
      v_report_id,
      coalesce(v_comp->>'kind', 'text'),
      v_comp->>'title',
      v_comp->'body',
      coalesce(v_comp->>'visibility', 'org'),
      v_branches,
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

  select organization_id into v_org from public.reports where id = p_report_id;
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

  for v_comp in select * from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) loop
    v_vis := coalesce(v_comp->>'visibility', 'org');
    if v_vis not in ('org','branch','restricted') then
      raise exception 'INVALID_COMPONENT_VISIBILITY';
    end if;
    v_branches := coalesce(
      (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_comp->'branch_ids', '[]'::jsonb)) x),
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
    v_branches := coalesce(
      (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_comp->'branch_ids', '[]'::jsonb)) x),
      '{}'::uuid[]
    );
    insert into public.report_components (report_id, kind, title, body, visibility, branch_ids, sort_order)
    values (
      p_report_id,
      coalesce(v_comp->>'kind', 'text'),
      v_comp->>'title',
      v_comp->'body',
      coalesce(v_comp->>'visibility', 'org'),
      v_branches,
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

grant execute on function public.publish_report(uuid, text, text, jsonb, jsonb, uuid[], uuid) to authenticated;
grant execute on function public.revise_report(uuid, text, text, jsonb, jsonb, uuid[], uuid) to authenticated;