-- ============================================================
-- P6.2 — Upsert instead of delete+insert for snapshot_report_kpis
--
-- Adds a unique constraint on (report_id, kind, title) and
-- updates the function to use INSERT ... ON CONFLICT for
-- idempotent snapshots.
-- ============================================================

-- Add unique constraint for upsert support (ignore null titles)
create unique index if not exists idx_report_components_unique
  on public.report_components (report_id, kind, coalesce(title, ''))
  where kind in ('chart', 'insight');

-- Update snapshot_report_kpis to use upsert
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

  -- collapse to the latest live dataset per application
  for v_ds in
    select distinct af.dataset_id as id
      from public.report_applications ra
      join public.application_files af on af.application_id = ra.application_id
      join public.datasets d on d.id = af.dataset_id
     where ra.report_id = p_report_id
       and d.status = 'ready'
  loop
    continue when v_ds is null;
    begin
      v_kpis := public.dataset_kpis(v_ds);
      if v_kpis = '{}'::jsonb then
        continue;
      end if;

      -- Upsert KPI insight
      insert into public.report_components (report_id, kind, title, body, sort_order)
      values (p_report_id, 'insight', 'KPI summary', v_kpis, 0)
      on conflict (report_id, kind, coalesce(title, ''))
      where kind in ('chart', 'insight')
      do update set
        body = excluded.body,
        sort_order = excluded.sort_order;

      select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'value', value) order by bucket), '[]'::jsonb)
        into v_series
        from public.time_series(v_ds, p_metric, 'month');

      -- Upsert chart
      insert into public.report_components (report_id, kind, title, body, sort_order)
      values (p_report_id, 'chart', p_metric || ' monthly', jsonb_build_object('series', v_series, 'metric', p_metric), 1)
      on conflict (report_id, kind, coalesce(title, ''))
      where kind in ('chart', 'insight')
      do update set
        body = excluded.body,
        sort_order = excluded.sort_order;

      v_cnt := v_cnt + 2;
    exception when others then
      null;
    end;
  end loop;

  return v_cnt;
end;
$$;

grant execute on function public.snapshot_report_kpis(uuid, text) to authenticated, service_role;
