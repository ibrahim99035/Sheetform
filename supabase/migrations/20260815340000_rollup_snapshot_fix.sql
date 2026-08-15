-- ============================================================
-- SiroQ Phase 3 fix — dataset→org linkage
-- datasets carry no organization_id; they belong to an org via
-- application_files.application_id -> applications.organization_id.
--   * association_rollup iterated `datasets.organization_id` (absent)
--   * snapshot_report_kpis used max(uuid) (no such aggregate)
-- Re-deploy both resolving datasets through applications.
-- ============================================================

create or replace function public.association_rollup(
  p_organization_id uuid,
  p_metric text default 'revenue',
  p_dataset_ids uuid[] default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_sum numeric := 0;
  v_cov int := 0;
  v_skip int := 0;
  v_row record;
  v_kpis jsonb;
begin
  for v_row in
    select distinct f.dataset_id as id
      from public.application_files f
      join public.applications a on a.id = f.application_id
     where a.organization_id = p_organization_id
       and (p_dataset_ids is null or f.dataset_id = any(p_dataset_ids))
  loop
    begin
      v_kpis := public.dataset_kpis(v_row.id);
      v_sum := v_sum + coalesce((v_kpis->>'revenue')::numeric, 0);
      v_cov := v_cov + 1;
    exception when others then
      v_skip := v_skip + 1;
    end;
  end loop;
  return jsonb_build_object(
    'datasets', (select count(distinct f.dataset_id)
                   from public.application_files f
                   join public.applications a on a.id = f.application_id
                  where a.organization_id = p_organization_id
                    and (p_dataset_ids is null or f.dataset_id = any(p_dataset_ids))),
    'covered', v_cov,
    'skipped', v_skip,
    'total', round(v_sum, 2)
  );
end;
$$;

create or replace function public.snapshot_report_kpis(
  p_report_id uuid,
  p_metric text default 'revenue'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_cnt int := 0;
  v_ds uuid;
  v_kpis jsonb;
  v_series jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  select organization_id into v_org from public.reports where id = p_report_id;
  if v_org is null then
    raise exception 'REPORT_NOT_FOUND';
  end if;

  delete from public.report_components where report_id = p_report_id and kind in ('chart','insight');

  -- collapse to the latest live dataset per application
  for v_ds in
    select distinct af.dataset_id as id
      from public.report_applications ra
      join public.application_files af on af.application_id = ra.application_id
      join public.datasets d on d.id = af.dataset_id
     where ra.report_id = p_report_id
       and d.deleted_at is null
  loop
    continue when v_ds is null;
    begin
      v_kpis := public.dataset_kpis(v_ds);
      if v_kpis = '{}'::jsonb then
        continue;
      end if;
      insert into public.report_components (report_id, kind, title, body, sort_order)
      values (p_report_id, 'insight', 'KPI summary', v_kpis, 0);
      select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'value', value) order by bucket), '[]'::jsonb)
        into v_series
        from public.time_series(v_ds, p_metric, 'month');
      insert into public.report_components (report_id, kind, title, body, sort_order)
      values (p_report_id, 'chart', p_metric || ' monthly', jsonb_build_object('series', v_series, 'metric', p_metric), 1);
      v_cnt := v_cnt + 2;
    exception when others then
      null;
    end;
  end loop;

  return v_cnt;
end;
$$;

grant execute on function public.association_rollup(uuid, text, uuid[]) to authenticated;
grant execute on function public.snapshot_report_kpis(uuid, text) to authenticated, service_role;