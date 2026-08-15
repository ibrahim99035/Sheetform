-- ============================================================
-- SiroQ Phase 3 — domain analysis engine
--   * _sf_to_num / _sf_to_ts guarded cast helpers
--   * _sf_template_key_map: template role -> storage key
--   * dataset_kpis(dataset)  -> one-row jsonb of KPIs
--   * time_series(dataset, metric, bucket) -> bucketed series
--
-- Design decisions:
--   * KPIs run over the LIVE dataset rows (soft-deletes and transforms
--     are honored, matching get_dataset_rows).
--   * All column references come from template_columns roles through
--     quote_literal'd keys — values only, never identifiers, so the
--     no-injection rule holds.
--   * Metrics are computed only for roles the template actually has;
--     a template without, say, a cost column yields null margin.
-- ============================================================

create or replace function public._sf_to_num(v text)
returns numeric
language sql
immutable
as $$
  select case
    when v is null or v = '' or v !~ '^-?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?$' then null
    else v::numeric
  end;
$$;

create or replace function public._sf_to_ts(v text)
returns timestamptz
language sql
immutable
as $$
  select case
    when v is null or v = '' then null
    else (v)::timestamptz
  end;
$$;

-- role -> storage key for a template (used by the KPI layer).
create or replace function public._sf_template_key_map(p_template_code text)
returns jsonb
language sql
stable
security invoker
as $$
  select coalesce(
    (select jsonb_object_agg(role, key)
       from public.template_columns
      where template_code = p_template_code and role is not null),
    '{}'::jsonb
  );
$$;

-- One-row KPIs for a template-conforming dataset.
create or replace function public.dataset_kpis(p_dataset_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_template text;
  v_defs jsonb;
  v_map jsonb;
  k text;
  v_qty text; v_price text; v_cost text; v_refund text;
  v_rev text; v_exp text; v_tax text;
  v_date text; v_prod text; v_txn text;
  v_revenue numeric; v_units numeric; v_cogs numeric; v_expense numeric; v_margin numeric;
  v_gp numeric; v_gp_pct numeric; v_avg_ticket numeric; v_products bigint;
  v_rows bigint; v_min_date text; v_max_date text;
  v_sql text;
begin
  select template_code, column_defs into v_template, v_defs
  from public.datasets where id = p_dataset_id;
  if v_template is null then
    return '{}'::jsonb;
  end if;

  v_map := public._sf_template_key_map(v_template);

  v_qty := v_map->>'qty';      v_price := v_map->>'unit_price';
  v_cost := v_map->>'cost';    v_refund := v_map->>'refund';
  v_rev := v_map->>'revenue';  v_exp := v_map->>'expense'; v_tax := v_map->>'tax';
  v_date := v_map->>'date';    v_prod := v_map->>'product'; v_txn := v_map->>'transaction_id';

  v_sql := 'select count(*)';

  if v_prod is not null then
    v_sql := v_sql || ', count(distinct data->>' || quote_literal(v_prod) || ')';
  else
    v_sql := v_sql || ', null';
  end if;

  -- revenue: sales template -> qty*price - refunds ; financial -> revenue col
  if v_qty is not null and v_price is not null then
    v_sql := v_sql || ', coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_qty) || ')
      * public._sf_to_num(data->>' || quote_literal(v_price) || ')), 0)';
  elsif v_rev is not null then
    v_sql := v_sql || ', coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_rev) || ')), 0)';
  else
    v_sql := v_sql || ', null';
  end if;

  if v_qty is not null then
    v_sql := v_sql || ', coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_qty) || ')), 0)';
  else
    v_sql := v_sql || ', null';
  end if;

  -- cogs
  if v_qty is not null and v_cost is not null then
    v_sql := v_sql || ', coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_qty) || ')
      * public._sf_to_num(data->>' || quote_literal(v_cost) || ')), 0)';
  else
    v_sql := v_sql || ', null';
  end if;

  -- expense (financial): subtracts from revenue
  if v_exp is not null then
    v_sql := v_sql || ', coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_exp) || ')), 0)';
  else
    v_sql := v_sql || ', null';
  end if;

  -- avg ticket
  if v_qty is not null and v_price is not null and v_txn is not null then
    v_sql := v_sql || ', (case when count(distinct data->>' || quote_literal(v_txn) || ') = 0 then null else
      (coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_qty) || ')
        * public._sf_to_num(data->>' || quote_literal(v_price) || ')), 0)
       )::numeric / count(distinct data->>' || quote_literal(v_txn) || ') end)';
  else
    v_sql := v_sql || ', null';
  end if;

  -- min/max date
  if v_date is not null then
    v_sql := v_sql || ', min(public._sf_to_ts(data->>' || quote_literal(v_date) || ')), max(public._sf_to_ts(data->>' || quote_literal(v_date) || '))';
  else
    v_sql := v_sql || ', null, null';
  end if;

  v_sql := v_sql || ' from public.dataset_rows where dataset_id = ' || quote_literal(p_dataset_id)
        || ' and deleted_at is null';

  execute v_sql into v_rows, v_products, v_revenue, v_units, v_cogs, v_expense, v_avg_ticket, v_min_date, v_max_date;

  v_revenue := coalesce(v_revenue, 0);
  v_margin := case when v_revenue is null then null
                   else v_revenue - coalesce(v_cogs, 0) - coalesce(v_expense, 0) end;
  v_gp := v_margin;
  v_gp_pct := case when v_revenue is null or v_revenue = 0 then null
                   else round(v_margin / v_revenue * 100.0, 2) end;

  return jsonb_build_object(
    'rows', v_rows,
    'distinct_products', v_products,
    'revenue', round(v_revenue, 2),
    'units', v_units,
    'cogs', round(coalesce(v_cogs, 0), 2),
    'expenses', round(coalesce(v_expense, 0), 2),
    'gross_margin', round(v_gp, 2),
    'gross_margin_pct', v_gp_pct,
    'avg_transaction', round(v_avg_ticket, 2),
    'min_date', v_min_date,
    'max_date', v_max_date
  );
end;
$$;

-- Bucketed metric series: metric in ('revenue','units','margin'); bucket in
-- ('day','month','quarter','year').
create or replace function public.time_series(
  p_dataset_id uuid,
  p_metric text default 'revenue',
  p_bucket text default 'month'
)
returns table (bucket text, value numeric)
language plpgsql
security invoker
as $$
declare
  v_template text;
  v_map jsonb;
  v_qty text; v_price text; v_cost text; v_exp text; v_rev text; v_date text;
  v_fmt text;
  v_metric_expr text;
  v_sql text;
begin
  select template_code into v_template from public.datasets where id = p_dataset_id;
  if v_template is null then
    return;
  end if;
  if p_bucket not in ('day','month','quarter','year') then
    raise exception 'INVALID_BUCKET';
  end if;

  v_map := public._sf_template_key_map(v_template);
  v_qty := v_map->>'qty'; v_price := v_map->>'unit_price';
  v_cost := v_map->>'cost'; v_exp := v_map->>'expense';
  v_rev := v_map->>'revenue'; v_date := v_map->>'date';
  if v_date is null then
    return;
  end if;

  case p_bucket
    when 'day' then v_fmt := 'YYYY-MM-DD';
    when 'month' then v_fmt := 'YYYY-MM';
    when 'quarter' then v_fmt := 'YYYY-"Q"Q';
    else v_fmt := 'YYYY';
  end case;

  if p_metric = 'units' then
    if v_qty is null then return; end if;
    v_metric_expr := 'sum(public._sf_to_num(data->>' || quote_literal(v_qty) || '))';
  elsif p_metric = 'margin' then
    if (v_qty is not null and v_price is not null) or v_rev is not null then
      v_metric_expr := '(';
      if v_qty is not null and v_price is not null then
        v_metric_expr := v_metric_expr || 'coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_qty) || ')
          * public._sf_to_num(data->>' || quote_literal(v_price) || ')),0)';
      elsif v_rev is not null then
        v_metric_expr := v_metric_expr || 'coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_rev) || ')),0)';
      end if;
      if v_cost is not null and v_qty is not null then
        v_metric_expr := v_metric_expr || ' - coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_qty) || ')
          * public._sf_to_num(data->>' || quote_literal(v_cost) || ')),0)';
      end if;
      if v_exp is not null then
        v_metric_expr := v_metric_expr || ' - coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_exp) || ')),0)';
      end if;
      v_metric_expr := v_metric_expr || ')';
    else
      return;
    end if;
  else -- revenue
    if v_qty is not null and v_price is not null then
      v_metric_expr := 'coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_qty) || ')
        * public._sf_to_num(data->>' || quote_literal(v_price) || ')),0)';
    elsif v_rev is not null then
      v_metric_expr := 'coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_rev) || ')),0)';
    else
      return;
    end if;
  end if;

  v_sql := 'select to_char(date_trunc(' || quote_literal(p_bucket)
        || ', public._sf_to_ts(data->>' || quote_literal(v_date) || ')), ' || quote_literal(v_fmt)
        || ') as bucket, ' || v_metric_expr
        || ' from public.dataset_rows where dataset_id = ' || quote_literal(p_dataset_id)
        || ' and deleted_at is null and data->>' || quote_literal(v_date) || ' is not null'
        || ' group by 1 order by 1';

  return query execute v_sql;
end;
$$;

-- Current vs previous period deltas. p_bucket in ('day','month','quarter','year').
-- Returns {label, current_value, prior_value, delta, delta_pct}.
create or replace function public.compare_periods(
  p_dataset_id uuid,
  p_metric text default 'revenue',
  p_bucket text default 'month'
)
returns table (label text, current_value numeric, prior_value numeric, delta numeric, delta_pct numeric)
language plpgsql
security invoker
as $$
declare
  v_template text;
  v_map jsonb;
  v_qty text; v_price text; v_cost text; v_exp text; v_rev text; v_date text;
  v_metric_expr text;
  v_now timestamptz;
  v_cur_min timestamptz;
  v_prev_min timestamptz;
  v_cur_max timestamptz;
  v_prev_max timestamptz;
  v_sql text;
  v_current numeric;
  v_prior numeric;
  v_label text;
begin
  select template_code into v_template from public.datasets where id = p_dataset_id;
  if v_template is null then
    return;
  end if;
  if p_bucket not in ('day','month','quarter','year') then
    raise exception 'INVALID_BUCKET';
  end if;

  v_map := public._sf_template_key_map(v_template);
  v_qty := v_map->>'qty'; v_price := v_map->>'unit_price';
  v_cost := v_map->>'cost'; v_exp := v_map->>'expense';
  v_rev := v_map->>'revenue'; v_date := v_map->>'date';
  if v_date is null then
    return;
  end if;

  if p_metric = 'units' then
    if v_qty is null then return; end if;
    v_metric_expr := 'sum(public._sf_to_num(data->>' || quote_literal(v_qty) || '))';
  elsif p_metric = 'margin' then
    if (v_qty is not null and v_price is not null) or v_rev is not null then
      v_metric_expr := '(';
      if v_qty is not null and v_price is not null then
        v_metric_expr := v_metric_expr || 'coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_qty) || ')
          * public._sf_to_num(data->>' || quote_literal(v_price) || ')),0)';
      elsif v_rev is not null then
        v_metric_expr := v_metric_expr || 'coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_rev) || ')),0)';
      end if;
      if v_cost is not null and v_qty is not null then
        v_metric_expr := v_metric_expr || ' - coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_qty) || ')
          * public._sf_to_num(data->>' || quote_literal(v_cost) || ')),0)';
      end if;
      if v_exp is not null then
        v_metric_expr := v_metric_expr || ' - coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_exp) || ')),0)';
      end if;
      v_metric_expr := v_metric_expr || ')';
    else
      return;
    end if;
  else -- revenue
    if v_qty is not null and v_price is not null then
      v_metric_expr := 'coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_qty) || ')
        * public._sf_to_num(data->>' || quote_literal(v_price) || ')),0)';
    elsif v_rev is not null then
      v_metric_expr := 'coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_rev) || ')),0)';
    else
      return;
    end if;
  end if;

  select min(public._sf_to_ts(data->>' || quote_literal(v_date) || ')),
         max(public._sf_to_ts(data->>' || quote_literal(v_date) || '))
    into v_cur_min, v_cur_max
     from public.dataset_rows
    where dataset_id = p_dataset_id and deleted_at is null;

  if v_cur_min is null then
    return;
  end if;

  case p_bucket
    when 'day' then
      v_prev_min := v_cur_min - interval '1 day';
      v_prev_max := v_cur_min - interval '1 microsecond';
      v_label := to_char(v_cur_min, 'YYYY-MM-DD');
    when 'month' then
      v_prev_min := date_trunc('month', v_cur_min) - interval '1 month';
      v_prev_max := date_trunc('month', v_cur_min) - interval '1 microsecond';
      v_label := to_char(date_trunc('month', v_cur_min), 'YYYY-MM');
    when 'quarter' then
      v_prev_min := date_trunc('quarter', v_cur_min) - interval '3 months';
      v_prev_max := date_trunc('quarter', v_cur_min) - interval '1 microsecond';
      v_label := to_char(date_trunc('quarter', v_cur_min), 'YYYY-"Q"Q');
    else
      v_prev_min := date_trunc('year', v_cur_min) - interval '1 year';
      v_prev_max := date_trunc('year', v_cur_min) - interval '1 microsecond';
      v_label := to_char(date_trunc('year', v_cur_min), 'YYYY');
  end case;

  -- Current period = entire live range if it spans more than one bucket,
  -- otherwise the bucket containing the range start.
  v_sql := 'select ' || v_metric_expr || ' from public.dataset_rows where dataset_id = '
        || quote_literal(p_dataset_id) || ' and deleted_at is null and data->>'
        || quote_literal(v_date) || ' is not null and public._sf_to_ts(data->>'
        || quote_literal(v_date) || ') <= ' || quote_literal(v_cur_max::text);
  execute v_sql into v_current;

  v_sql := 'select ' || v_metric_expr || ' from public.dataset_rows where dataset_id = '
        || quote_literal(p_dataset_id) || ' and deleted_at is null and data->>'
        || quote_literal(v_date) || ' is not null and public._sf_to_ts(data->>'
        || quote_literal(v_date) || ') >= ' || quote_literal(v_prev_min::text)
        || ' and public._sf_to_ts(data->>' || quote_literal(v_date) || ') < '
        || quote_literal(v_cur_min::text);
  execute v_sql into v_prior;

  label := v_label;
  current_value := round(v_current, 2);
  prior_value := round(v_prior, 2);
  delta := round(coalesce(v_current, 0) - coalesce(v_prior, 0), 2);
  delta_pct := case when coalesce(v_prior, 0) = 0 then null
                    else round((coalesce(v_current, 0) - coalesce(v_prior, 0)) / v_prior * 100.0, 2) end;
  return next;
end;
$$;

-- Association rollup: aggregates a metric across the live datasets of a branch
-- or org. p_dataset_ids filters to a specific branch; null returns all org datasets.
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
  v_no_template int := 0;
  v_skip int := 0;
  v_row record;
begin
  for v_row in
    select d.id
      from public.datasets d
     where d.organization_id = p_organization_id
       and (p_dataset_ids is null or d.id = any(p_dataset_ids))
       and exists (select 1 from public.application_files f where f.dataset_id = d.id)
  loop
    begin
      v_sum := v_sum + coalesce((public.dataset_kpis(v_row.id)->>'revenue')::numeric, 0);
      v_cov := v_cov + 1;
    exception when others then
      v_skip := v_skip + 1;
    end;
  end loop;
  return jsonb_build_object(
    'datasets', (select count(*) from public.datasets d
                  where d.organization_id = p_organization_id
                    and (p_dataset_ids is null or d.id = any(p_dataset_ids))),
    'covered', v_cov,
    'skipped', v_skip,
    'total', round(v_sum, 2)
  );
end;
$$;

-- Operator snapshots live KPIs + time series of the report's input datasets
-- into report_components (kind 'chart'/'insight'), so published reports are
-- self-contained documents.
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
  v_app uuid;
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
    select max(a2.id) -- dataset id via application_files
      from public.report_applications ra
      join public.application_files af on af.application_id = ra.application_id
      join public.datasets a2 on a2.id = af.dataset_id
     where ra.report_id = p_report_id
       and a2.deleted_at is null
    group by ra.application_id
    order by ra.application_id
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

grant execute on function public._sf_to_num(text) to authenticated;
grant execute on function public._sf_to_ts(text) to authenticated;
grant execute on function public._sf_template_key_map(text) to authenticated;
grant execute on function public.dataset_kpis(uuid) to authenticated;
grant execute on function public.time_series(uuid, text, text) to authenticated;
grant execute on function public.compare_periods(uuid, text, text) to authenticated;
grant execute on function public.association_rollup(uuid, text, uuid[]) to authenticated;
grant execute on function public.snapshot_report_kpis(uuid, text) to authenticated, service_role;