-- ============================================================
-- SiroQ Analysis Engine
--   * _sf_to_num / _sf_to_ts hardened casts (currency symbols,
--     thousand separators, decimal commas, tolerant date formats)
--   * _sf_dataset_key_map: role->key resolver that works WITHOUT a
--     template (auto-inferred roles from column_defs), with template
--     fallback for legacy/template-created datasets
--   * KPI/time_series/compare_periods refactored onto the resolver
--   * New RPCs: rank_samples (top/bottom N), refund_rate,
--     concentration, time_pattern (day-of-week / hour), quality_profile,
--     branch_ranking
--   * dataset_analyses: persisted snapshot of a full engine run
--   * dataset_column_stats.invalid_count: parse-failure tracking from
--     the import pipeline (the only place raw strings are still visible)
--
-- Security: every dynamic expression references COLUMN KEYS through
-- quote_literal (values only, never identifiers) — same rule as the
-- existing KPI layer. New RPCs are security invoker; the operator is
-- the only role with read access to dataset tables.
-- ============================================================

-- ---------- Hardened numeric cast ----------
-- Handles: "€12,50" -> 12.50, "1.234,56" -> 1234.56, "12 500.00" -> 12500,
-- "1,234,567.89" -> 1234567.89, exponents. Ambiguous single-separator cases
-- follow the currency convention (a lone trailing group of 3 = thousands).
create or replace function public._sf_to_num(v text)
returns numeric
language plpgsql
immutable
as $$
declare
  s text;
  sign text := '';
  exp text := '';
  cleaned text;
  out numeric;
begin
  if v is null then
    return null;
  end if;

  -- keep only numeric/sign/separator/e/spaces, drop everything else
  s := regexp_replace(v, '[^0-9+\-.,eE[:space:]]', '', 'g');
  -- collapse spaces (thousand separators) and trim
  s := btrim(regexp_replace(s, '[:space:]+', '', 'g'));

  if s = '' then
    return null;
  end if;
  if s !~ '^[+-]?[0-9][0-9.,]*([eE][+-]?[0-9]+)?$' then
    return null;
  end if;

  if s ~ '^[+-]' then
    sign := substring(s from 1 for 1);
    s := substring(s from 2);
  end if;

  if s ~ '[eE]' then
    exp := substring(s from '[eE][+-]?[0-9]+');
    s := substring(s from 1 for ((strpos(s, substring(s from '[eE]')) - 1)));
  end if;

  -- all separator interpretation is delegated to _sf_normalize_num
  cleaned := public._sf_normalize_num(s);
  if cleaned is null then
    return null;
  end if;

  begin
    out := (sign || cleaned || exp)::numeric;
  exception when others then
    return null;
  end;
  return out;
end;
$$;

-- Internal: produce "digits[.digits]" from a string of digits+separators
-- using the currency convention for ambiguous cases.
create or replace function public._sf_normalize_num(s text)
returns text
language plpgsql
immutable
as $$
declare
  dcount int;
  ccount int;
  last_comma int;
  last_dot int;
  after_comma int;
  after_dot int;
begin
  if s is null or s = '' then
    return null;
  end if;
  dcount := length(s) - length(regexp_replace(s, ',', '', 'g'));
  ccount := length(s) - length(regexp_replace(s, '.', '', 'g'));
  last_comma := strpos(s, ',');
  last_dot := strpos(s, '.');

  -- both separators: the LAST one is the decimal separator
  if dcount > 0 and ccount > 0 then
    if last_comma > last_dot then
      -- comma decimal, dots are thousands
      s := replace(s, '.', '');
      s := replace(s, ',', '.');
    else
      -- dot decimal, commas are thousands
      s := replace(s, ',', '');
    end if;
    return case when s ~ '^[0-9]+(\.[0-9]+)?$' then s else null end;
  end if;

  -- only commas
  if dcount > 0 then
    after_comma := length(s) - last_comma;
    if after_comma <= 2 then
      -- decimal comma
      s := substr(s, 1, last_comma - 1) || '.' || substr(s, last_comma + 1);
      s := replace(s, ',', '.');
    else
      -- thousands (remove all commas)
      s := replace(s, ',', '');
    end if;
    return case when s ~ '^[0-9]*(\.[0-9]+)?$' and s ~ '[0-9]' then s else null end;
  end if;

  -- only dots
  if ccount > 0 then
    if ccount = 1 then
      after_comma := length(s) - last_dot;
      after_dot := last_dot - 1;
      if after_comma = 3 and after_dot <= 3 then
        s := replace(s, '.', ''); -- grouped thousands (ambiguous but currency-typical)
      end if;
    else
      -- multi-dot: treat as thousands groups only when well formed
      if s ~ '^[0-9]{1,3}([.][0-9]{3})+$' then
        s := replace(s, '.', '');
      else
        return null;
      end if;
    end if;
    return case when s ~ '^[0-9]*(\.[0-9]+)?$' and s ~ '[0-9]' then s else null end;
  end if;

  -- no separators
  return case when s ~ '^[0-9]+$' then s else null end;
end;
$$;

-- ---------- Tolerant timestamp cast ----------
create or replace function public._sf_to_ts(v text)
returns timestamptz
language plpgsql
immutable
as $$
declare
  tz text;
  fmt text;
  val text;
begin
  if v is null or btrim(v) = '' then
    return null;
  end if;
  val := btrim(v);

  -- fast paths
  begin
    return val::timestamptz;
  exception when others then
    null;
  end;

  foreach fmt in array array['YYYY-MM-DD','YYYY-MM-DD HH24:MI','YYYY-MM-DD HH24:MI:SS',
                          'DD/MM/YYYY','DD/MM/YYYY HH24:MI','DD/MM/YYYY HH24:MI:SS',
                          'MM/DD/YYYY','MM/DD/YYYY HH24:MI','MM/DD/YYYY HH24:MI:SS',
                          'DD-MM-YYYY','YYYY.MM.DD','DD.MM.YYYY','DD.MM.YYYY HH24:MI',
                          'Mon DD, YYYY','Month DD, YYYY','DD Mon YYYY','DD Mon YYYY HH24:MI'] loop
    begin
      return to_timestamp(val, fmt) at time zone 'UTC';
    exception when others then
      null;
    end;
  end loop;

  -- numeric epoch fallback (seconds)
  begin
    return to_timestamp(val::numeric) at time zone 'UTC';
  exception when others then
    null;
  end;

  return null;
end;
$$;

-- ---------- Role resolver ----------
-- Role -> storage key for a dataset. Auto-inferred roles stored in
-- column_defs win; missing roles fall back to the template's canonical
-- map when a template is attached (legacy/template-created datasets).
create or replace function public._sf_dataset_key_map(p_dataset_id uuid)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  v_defs jsonb;
  v_tmpl text;
  v_map jsonb;
  v_tmpl_map jsonb;
  v_key text;
begin
  select column_defs, template_code into v_defs, v_tmpl
  from public.datasets where id = p_dataset_id;
  if v_defs is null then
    return '{}'::jsonb;
  end if;

  select coalesce(jsonb_object_agg(e->>'role', e->>'key'), '{}'::jsonb)
    into v_map
    from jsonb_array_elements(v_defs) e
   where e->>'role' is not null and e->>'role' <> '';

  if v_tmpl is not null then
    v_tmpl_map := public._sf_template_key_map(v_tmpl);
    for v_key in select jsonb_object_keys(v_tmpl_map) loop
      if not v_map ? v_key then
        v_map := v_map || jsonb_build_object(v_key, v_tmpl_map->v_key);
      end if;
    end loop;
  end if;

  return v_map;
end;
$$;

-- ---------- Refactor KPI layer onto the resolver ----------

create or replace function public.dataset_kpis(p_dataset_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
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
  v_map := public._sf_dataset_key_map(p_dataset_id);
  if v_map = '{}'::jsonb then
    return '{}'::jsonb;
  end if;

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

  -- revenue: sales -> qty*price (gross; refunds reported separately) ;
  -- financial -> revenue col
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

-- Bucketed metric series (metric in revenue/units/margin; bucket day/month/quarter/year)
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
  v_map jsonb;
  v_qty text; v_price text; v_cost text; v_exp text; v_rev text; v_date text;
  v_fmt text;
  v_metric_expr text;
  v_sql text;
begin
  v_map := public._sf_dataset_key_map(p_dataset_id);
  if v_map = '{}'::jsonb then
    return;
  end if;
  if p_bucket not in ('day','month','quarter','year') then
    raise exception 'INVALID_BUCKET';
  end if;

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

-- Latest vs previous bucket (via time_series, stable ordering)
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
  v_points jsonb;
  v_n int;
  v_last jsonb;
  v_prev jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('label', s.label, 'value', s.value)), '[]'::jsonb)
    into v_points
    from (
      select t.bucket as label, t.value
        from public.time_series(p_dataset_id, p_metric, p_bucket) t
      order by t.bucket desc
      limit 2
    ) s;

  v_n := jsonb_array_length(v_points);
  if v_n = 0 then
    return;
  end if;

  v_last := v_points->0;
  label := v_last->>'label';
  current_value := (v_last->>'value')::numeric;
  if v_n = 1 then
    prior_value := null;
    delta := null;
    delta_pct := null;
    return next;
    return;
  end if;

  v_prev := v_points->1;
  prior_value := (v_prev->>'value')::numeric;
  delta := round(current_value - prior_value, 2);
  delta_pct := case when prior_value = 0 then null
                    else round((current_value - prior_value) / prior_value * 100.0, 2) end;
  return next;
end;
$$;

-- ---------- Ranking (top/bottom N by product/category) ----------
create or replace function public.rank_samples(
  p_dataset_id uuid,
  p_roles jsonb default null,
  p_dimension text default 'product',
  p_metric text default 'revenue',
  p_n int default 10,
  p_dir text default 'desc'
)
returns table (label text, value numeric, units numeric, grp_count bigint)
language plpgsql
security invoker
stable
as $$
declare
  v_roles jsonb := coalesce(p_roles, public._sf_dataset_key_map(p_dataset_id));
  v_gkey text;
  v_qty text;
  v_price text;
  v_cost text;
  v_rev text;
  v_units_expr text;
  v_metric_expr text;
  v_order_dir text := case when p_dir = 'asc' then 'asc' else 'desc' end;
  v_limit int := greatest(1, least(coalesce(p_n, 10), 500));
  v_sql text;
begin
  if p_dimension = 'category' then v_gkey := v_roles->>'category';
  elsif p_dimension = 'product' then v_gkey := v_roles->>'product';
  else raise exception 'INVALID_DIMENSION'; end if;
  if v_gkey is null then
    raise exception 'NO_DIMENSION';
  end if;

  v_qty := v_roles->>'qty'; v_price := v_roles->>'unit_price';
  v_cost := v_roles->>'cost'; v_rev := v_roles->>'revenue';

  v_units_expr := case when v_qty is null then 'null::numeric'
                       else 'sum(public._sf_to_num(data->>' || quote_literal(v_qty) || '))' end;

  if p_metric = 'units' then
    v_metric_expr := v_units_expr;
  elsif p_metric = 'margin' then
    if v_qty is not null and v_price is not null and v_cost is not null then
      v_metric_expr := '(sum(public._sf_to_num(data->>' || quote_literal(v_qty) || ')
        * public._sf_to_num(data->>' || quote_literal(v_price) || ')) - sum(public._sf_to_num(data->>'
        || quote_literal(v_qty) || ') * public._sf_to_num(data->>' || quote_literal(v_cost) || ')))';
    elsif v_rev is not null then
      v_metric_expr := 'sum(public._sf_to_num(data->>' || quote_literal(v_rev) || '))';
    else
      raise exception 'NO_METRIC';
    end if;
  elsif p_metric = 'revenue' then
    if v_qty is not null and v_price is not null then
      v_metric_expr := 'coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_qty) || ')
        * public._sf_to_num(data->>' || quote_literal(v_price) || ')),0)';
    elsif v_rev is not null then
      v_metric_expr := 'coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_rev) || ')),0)';
    else
      raise exception 'NO_METRIC';
    end if;
  else
    raise exception 'INVALID_METRIC';
  end if;

  v_sql := format(
    'select coalesce(nullif(btrim(data->>%L), ''''), ''(blank)'') as label, %s as value, %s as units, count(*)::bigint as grp_count
       from public.dataset_rows
      where dataset_id = %L and deleted_at is null and data->>%L is not null
      group by data->>%L
      order by value %s, grp_count desc, label
      limit %s',
    v_gkey, v_metric_expr, v_units_expr, p_dataset_id, v_gkey, v_gkey, v_order_dir, v_limit
  );

  return query execute v_sql;
end;
$$;

-- ---------- Refund rate ----------
create or replace function public.refund_rate(
  p_dataset_id uuid,
  p_roles jsonb default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_roles jsonb := coalesce(p_roles, public._sf_dataset_key_map(p_dataset_id));
  v_refund text := v_roles->>'refund';
  v_qty text := v_roles->>'qty';
  v_price text := v_roles->>'unit_price';
  v_rev text := v_roles->>'revenue';
  v_gross numeric;
  v_refunds numeric;
  v_refund_rows bigint;
  v_neg_qty numeric;
  v_neg_rows bigint;
  v_pct numeric;
  v_sql text;
  v_units_expr text;
begin
  -- gross revenue
  if v_qty is not null and v_price is not null then
    v_sql := 'select coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_qty) || ')
      * public._sf_to_num(data->>' || quote_literal(v_price) || ')), 0)
      from public.dataset_rows where dataset_id = ' || quote_literal(p_dataset_id) || ' and deleted_at is null';
    execute v_sql into v_gross;
  elsif v_rev is not null then
    v_sql := 'select coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_rev) || ')), 0)
      from public.dataset_rows where dataset_id = ' || quote_literal(p_dataset_id) || ' and deleted_at is null';
    execute v_sql into v_gross;
  end if;

  -- explicit refund column (values may be positive or negative amounts)
  if v_refund is not null then
    v_sql := format(
      'select abs(coalesce(sum(public._sf_to_num(data->>%L)), 0)),
              count(*) filter (where coalesce(public._sf_to_num(data->>%L),0) <> 0)
         from public.dataset_rows
        where dataset_id = %L and deleted_at is null',
      v_refund, v_refund, p_dataset_id
    );
    execute v_sql into v_refunds, v_refund_rows;
  end if;

  -- negative-quantity heuristic when no refund column exists
  if v_qty is not null then
    v_units_expr := 'public._sf_to_num(data->>' || quote_literal(v_qty) || ')';
    if v_price is not null then
      v_sql := 'select coalesce(abs(sum(' || v_units_expr || ' * public._sf_to_num(data->>'
        || quote_literal(v_price) || '))), 0), count(*) filter (where ' || v_units_expr || ' < 0)
        from public.dataset_rows where dataset_id = ' || quote_literal(p_dataset_id) || ' and deleted_at is null';
    else
      v_sql := 'select coalesce(abs(sum(' || v_units_expr || ')), 0), count(*) filter (where '
        || v_units_expr || ' < 0)
        from public.dataset_rows where dataset_id = ' || quote_literal(p_dataset_id) || ' and deleted_at is null';
    end if;
    execute v_sql into v_neg_qty, v_neg_rows;
  end if;

  -- prefer explicit refund column; fall back to negative-qty estimate
  if v_refunds is not null then
    v_pct := case when coalesce(v_gross,0) = 0 then null
                  else round(v_refunds / v_gross * 100.0, 2) end;
    return jsonb_build_object(
      'gross_revenue', round(coalesce(v_gross,0),2),
      'refunds', round(v_refunds,2),
      'refund_rows', coalesce(v_refund_rows,0),
      'refund_rate_pct', v_pct,
      'estimated', false
    );
  elsif v_neg_rows is not null and v_neg_rows > 0 then
    v_pct := case when coalesce(v_gross,0) = 0 then null
                  else round(abs(v_neg_qty) / v_gross * 100.0, 2) end;
    return jsonb_build_object(
      'gross_revenue', round(coalesce(v_gross,0),2),
      'refunds', round(abs(v_neg_qty),2),
      'refund_rows', v_neg_rows,
      'refund_rate_pct', v_pct,
      'estimated', true
    );
  end if;

  return jsonb_build_object('gross_revenue', round(coalesce(v_gross,0),2), 'refunds', null, 'refund_rows', null, 'refund_rate_pct', null, 'estimated', false);
end;
$$;

-- ---------- Concentration risk ----------
create or replace function public.concentration(
  p_dataset_id uuid,
  p_roles jsonb default null,
  p_n int default 20
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_roles jsonb := coalesce(p_roles, public._sf_dataset_key_map(p_dataset_id));
  v_gkey text := v_roles->>'product';
  v_qty text := v_roles->>'qty';
  v_price text := v_roles->>'unit_price';
  v_rev text := v_roles->>'revenue';
  v_metric_expr text;
  v_sql text;
  v_total numeric;
  v_products bigint;
  v_top5 jsonb := '[]'::jsonb;
  v_top_n jsonb := '[]'::jsonb;
  v_share_top5 numeric;
  v_share_top_n numeric;
  v_limit int := greatest(1, least(coalesce(p_n,20), 500));
begin
  if v_gkey is null then
    return jsonb_build_object('available', false);
  end if;
  if v_qty is not null and v_price is not null then
    v_metric_expr := 'sum(public._sf_to_num(data->>' || quote_literal(v_qty) || ')
      * public._sf_to_num(data->>' || quote_literal(v_price) || '))';
  elsif v_rev is not null then
    v_metric_expr := 'sum(public._sf_to_num(data->>' || quote_literal(v_rev) || '))';
  else
    return jsonb_build_object('available', false);
  end if;

  v_sql := format('with ranked as (
        select coalesce(data->>%L, ''(blank)'') as label, %s as v
          from public.dataset_rows
         where dataset_id = %L and deleted_at is null
         group by data->>%L
      )
      select
        (select round(sum(v),2) from ranked) as total,
        (select count(*) from ranked) as products,
        coalesce((select jsonb_agg(jsonb_build_object(''label'', label, ''value'', round(v,2)) order by v desc limit 5)
           from ranked), ''[]''::jsonb),
        coalesce((select jsonb_agg(jsonb_build_object(''label'', label, ''value'', round(v,2)) order by v desc limit %s)
           from ranked), ''[]''::jsonb),
        round(coalesce((select sum(v) from ranked order by v desc limit 5), 0) /
          nullif((select sum(v) from ranked), 0) * 100.0, 2),
        round(coalesce((select sum(v) from ranked order by v desc limit %s), 0) /
          nullif((select sum(v) from ranked), 0) * 100.0, 2)
      ',
    v_gkey, v_metric_expr, p_dataset_id, v_gkey, v_limit, v_limit
  );

  execute v_sql into v_total, v_products, v_top5, v_top_n, v_share_top5, v_share_top_n;

  return jsonb_build_object(
    'available', true,
    'total_revenue', round(coalesce(v_total,0),2),
    'distinct_products', coalesce(v_products, 0),
    'top5', v_top5,
    'top', v_top_n,
    'top5_share_pct', v_share_top5,
    'top' || v_limit || '_share_pct', v_share_top_n
  );
end;
$$;

-- ---------- Time patterns (day-of-week / hour-of-day) ----------
create or replace function public.time_pattern(
  p_dataset_id uuid,
  p_roles jsonb default null,
  p_granularity text default 'dow'
)
returns table (label text, value numeric, units numeric, grp_count bigint)
language plpgsql
security invoker
stable
as $$
declare
  v_roles jsonb := coalesce(p_roles, public._sf_dataset_key_map(p_dataset_id));
  v_date text := v_roles->>'date';
  v_qty text := v_roles->>'qty';
  v_price text := v_roles->>'unit_price';
  v_rev text := v_roles->>'revenue';
  v_units_expr text;
  v_metric_expr text;
  v_bucket_expr text;
  v_order text;
  v_sql text;
begin
  if v_date is null then
    raise exception 'NO_DATE';
  end if;
  if p_granularity not in ('dow','hour') then
    raise exception 'INVALID_GRANULARITY';
  end if;

  v_units_expr := case when v_qty is null then 'null::numeric'
                       else 'sum(public._sf_to_num(data->>' || quote_literal(v_qty) || '))' end;
  if v_qty is not null and v_price is not null then
    v_metric_expr := 'coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_qty) || ')
      * public._sf_to_num(data->>' || quote_literal(v_price) || ')),0)';
  elsif v_rev is not null then
    v_metric_expr := 'coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_rev) || ')),0)';
  else
    return;
  end if;

  if p_granularity = 'dow' then
    v_bucket_expr := 'case extract(isodow from public._sf_to_ts(data->>' || quote_literal(v_date) || '))
        when 1 then ''Mon'' when 2 then ''Tue'' when 3 then ''Wed'' when 4 then ''Thu''
        when 5 then ''Fri'' when 6 then ''Sat'' else ''Sun'' end';
    v_order := 'min(extract(isodow from public._sf_to_ts(data->>' || quote_literal(v_date) || ')))';
  else
    v_bucket_expr := 'to_char(extract(hour from public._sf_to_ts(data->>' || quote_literal(v_date) || ')), ''FM00'') || ''h''';
    v_order := 'extract(hour from public._sf_to_ts(data->>' || quote_literal(v_date) || '))';
  end if;

  v_sql := format(
    'select %s as label, %s as value, %s as units, count(*)::bigint as grp_count
       from public.dataset_rows
      where dataset_id = %L and deleted_at is null and data->>%L is not null
        and public._sf_to_ts(data->>%L) is not null
      group by 1 order by %s',
    v_bucket_expr, v_metric_expr, v_units_expr, p_dataset_id, v_date, v_date, v_order
  );

  return query execute v_sql;
end;
$$;

-- ---------- Branch ranking across an organization ----------
-- Aggregates the revenue of each branch's latest live datasets. Uses the
-- dataset's own branch column when present, else the application-scoped
-- branch. Conservative: only datasets with a resolvable revenue are counted.
-- Uses a per-call temp accumulator so concurrent invocations don't collide.
create or replace function public.branch_ranking(p_organization_id uuid)
returns table (branch text, revenue numeric, datasets int)
language plpgsql
security invoker
as $$
declare
  v_row record;
  v_kpis jsonb;
  v_rev numeric;
  v_branch_col text;
  v_branch_label text;
  v_map jsonb;
  v_acc text;
begin
  v_acc := 'branch_acc_' || replace(gen_random_uuid()::text, '-', '');
  perform format('create temporary table %I (branch text primary key, revenue numeric not null default 0, datasets int not null default 0)', v_acc);

  for v_row in
    select d.id as dataset_id,
           coalesce(a.branch_id, '00000000-0000-0000-0000-000000000000') as app_branch,
           b.name as branch_name
      from public.datasets d
      join public.application_files f on f.dataset_id = d.id
      join public.applications a on a.id = f.application_id
      left join public.branches b on b.id = a.branch_id and b.organization_id = a.organization_id
     where a.organization_id = p_organization_id
       and d.deleted_at is null
       and d.status = 'ready'
     group by d.id, a.branch_id, b.name
  loop
    begin
      v_kpis := public.dataset_kpis(v_row.dataset_id);
      v_rev := coalesce((v_kpis->>'revenue')::numeric, 0);
      v_map := public._sf_dataset_key_map(v_row.dataset_id);
      v_branch_col := v_map->>'branch';
      if v_branch_col is not null then
        select coalesce(max(btrim(data->>v_branch_col)) filter (where btrim(data->>v_branch_col) <> ''), v_row.branch_name)
          into v_branch_label
          from public.dataset_rows
         where dataset_id = v_row.dataset_id and deleted_at is null
         group by dataset_id;
        if v_branch_label is null then
          v_branch_label := v_row.branch_name;
        end if;
      else
        v_branch_label := v_row.branch_name;
      end if;

      v_branch_label := coalesce(NULLIF(btrim(v_branch_label), ''), 'Unassigned');

      perform format('insert into %I (branch, revenue, datasets) values (%L, %s, 1)
                        on conflict (branch) do update set revenue = %I.revenue + excluded.revenue, datasets = %I.datasets + 1',
        v_acc, v_branch_label, v_rev::text, v_acc, v_acc);
    exception when others then
      null;
    end;
  end loop;

  return query execute format(
    'select branch, round(revenue, 2), datasets from %I order by revenue desc', v_acc
  );
end;
$$;

-- ---------- Quality profile ----------
create or replace function public.quality_profile(
  p_dataset_id uuid,
  p_roles jsonb default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_roles jsonb := coalesce(p_roles, public._sf_dataset_key_map(p_dataset_id));
  v_defs jsonb;
  v_rows bigint;
  v_cols jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_key text;
  v_label text;
  v_type text;
  v_role text;
  v_conf text;
  v_stats record;
  v_missing_pct numeric;
  v_invalid_pct numeric;
  v_distinct_pct numeric;
  v_neg bigint;
  v_std numeric;
  v_outlier boolean;
  v_currency text;
  v_flag jsonb;
  v_flags jsonb := '[]'::jsonb;
begin
  select column_defs into v_defs from public.datasets where id = p_dataset_id;
  if v_defs is null then
    return jsonb_build_object('rows', 0, 'columns', '[]'::jsonb, 'flags', '[]'::jsonb);
  end if;

  select count(*) into v_rows from public.dataset_rows
   where dataset_id = p_dataset_id and deleted_at is null;

  for v_elem in select * from jsonb_array_elements(v_defs) loop
    v_key := v_elem->>'key';
    v_label := v_elem->>'label';
    v_type := v_elem->>'type';
    v_role := v_elem->>'role';
    v_conf := v_elem->>'role_confidence';

    select s.null_count, s.distinct_count, coalesce(s.invalid_count, 0),
           s.min, s.max, s.avg
      into v_stats
      from public.dataset_column_stats s
     where s.dataset_id = p_dataset_id and s.column_key = v_key;

    v_missing_pct := case when v_rows = 0 then 0 else round(coalesce(v_stats.null_count, 0) * 100.0 / v_rows, 1) end;
    v_invalid_pct := case when v_rows = 0 then 0 else round(coalesce(v_stats.invalid_count, 0) * 100.0 / v_rows, 1) end;
    v_distinct_pct := case when v_rows = 0 then 0 else round(coalesce(v_stats.distinct_count, 0) * 100.0 / v_rows, 1) end;

    v_neg := 0; v_std := null; v_outlier := false; v_currency := null;

    if v_type = 'numeric' then
      -- negative-value count (potential refunds/voids)
      select count(*) into v_neg from public.dataset_rows
       where dataset_id = p_dataset_id and deleted_at is null
         and public._sf_to_num(data->>v_key) < 0;

      select stddev(public._sf_to_num(data->>v_key)),
             max(public._sf_to_num(data->>v_key)),
             min(public._sf_to_num(data->>v_key)),
             avg(public._sf_to_num(data->>v_key))
        into v_std, v_stats.max, v_stats.min, v_stats.avg
        from public.dataset_rows
       where dataset_id = p_dataset_id and deleted_at is null;

      if coalesce(v_std, 0) > 0 and v_stats.avg is not null then
        v_outlier := (v_stats.max is not null and v_stats.max > v_stats.avg + 4 * v_std)
                  or (v_stats.min is not null and v_stats.min < v_stats.avg - 4 * v_std);
      end if;
    elsif v_type = 'string' and v_role in ('product','category','branch') then
    end if;

    -- currency detection on string columns (raw symbols survive in strings)
    if v_type = 'string' then
      select string_agg(sym, ', ' order by sym)
        into v_currency
        from (
          select s.sym
            from (select unnest(array['€','$','£','₺','ر.س',' د.م']) as sym) s
           where exists (
             select 1 from public.dataset_rows r
              where r.dataset_id = p_dataset_id and r.deleted_at is null
                and r.data->>v_key like '%' || s.sym || '%'
                and length(r.data->>v_key) < 60
           )
           limit 3
        ) t;
      if v_currency is not null and v_currency = '' then v_currency := null; end if;
    end if;

    v_cols := v_cols || jsonb_build_object(
      'key', v_key,
      'label', v_label,
      'type', v_type,
      'role', v_role,
      'role_confidence', v_conf,
      'missing_pct', v_missing_pct,
      'invalid_pct', v_invalid_pct,
      'distinct_pct', v_distinct_pct,
      'negative_count', v_neg,
      'outlier', v_outlier,
      'min', v_stats.min,
      'max', v_stats.max,
      'avg', case when v_stats.avg is null then null else round(v_stats.avg, 2) end,
      'currency_symbols', v_currency
    );
  end loop;

  -- global flags
  if v_rows = 0 then
    v_flags := v_flags || jsonb_build_object('level', 'high', 'message', 'The dataset has no live rows.');
  end if;

  select jsonb_agg(c) into v_cols from jsonb_array_elements(v_cols) c;

  return jsonb_build_object(
    'rows', v_rows,
    'columns', v_cols,
    'flags', v_flags
  );
end;
$$;

-- ---------- invalid_count column ----------
alter table public.dataset_column_stats
  add column if not exists invalid_count integer not null default 0;

-- recompute helper: keep import-time invalid counts (transform tape operates
-- on already-coerced values, so raw parse-failure info can only come from
-- the import snapshot)
create or replace function public._sf_recompute_column_stats(
  p_dataset_id uuid,
  p_column_key text,
  p_col_type text
)
returns void
language plpgsql
security invoker
as $$
declare
  v_min numeric;
  v_max numeric;
  v_avg numeric;
  v_sum numeric;
  v_distinct bigint;
  v_null bigint;
begin
  if p_col_type = 'numeric' then
    select min((data->>p_column_key)::numeric), max((data->>p_column_key)::numeric),
           avg((data->>p_column_key)::numeric), sum((data->>p_column_key)::numeric),
           count(distinct data->>p_column_key),
           count(*) filter (where not (data ? p_column_key and data->p_column_key is not null))
    into v_min, v_max, v_avg, v_sum, v_distinct, v_null
    from public.dataset_rows
    where dataset_id = p_dataset_id and deleted_at is null;
  else
    select count(distinct data->>p_column_key),
           count(*) filter (where not (data ? p_column_key and data->p_column_key is not null))
    into v_distinct, v_null
    from public.dataset_rows
    where dataset_id = p_dataset_id and deleted_at is null;
  end if;

  insert into public.dataset_column_stats
    (dataset_id, column_key, min, max, avg, sum, distinct_count, null_count, invalid_count, computed_at)
  values
    (p_dataset_id, p_column_key, v_min, v_max, v_avg, v_sum, coalesce(v_distinct, 0), coalesce(v_null, 0),
     coalesce((select invalid_count from public.dataset_column_stats
                where dataset_id = p_dataset_id and column_key = p_column_key), 0),
     now())
  on conflict (dataset_id, column_key)
  do update set
    min = excluded.min, max = excluded.max, avg = excluded.avg, sum = excluded.sum,
    distinct_count = excluded.distinct_count, null_count = excluded.null_count,
    invalid_count = excluded.invalid_count,
    computed_at = excluded.computed_at;
end;
$$;

-- ---------- Persisted analysis snapshot ----------
create table public.dataset_analyses (
  dataset_id uuid primary key references public.datasets(id) on delete cascade,
  roles jsonb not null default '{}',
  report jsonb not null default '{}',
  markdown text,
  sensitivity text not null default 'sales_financial'
    check (sensitivity in ('none','sales_financial','patient_health')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.dataset_analyses to authenticated, service_role;

alter table public.dataset_analyses enable row level security;
create policy "admin analysis" on public.dataset_analyses
  for all using (public.is_superadmin())
  with check (public.is_superadmin());

-- ---------- Grants ----------
grant execute on function public._sf_to_num(text) to authenticated, anon;
grant execute on function public._sf_normalize_num(text) to authenticated, anon;
grant execute on function public._sf_to_ts(text) to authenticated, anon;
grant execute on function public._sf_dataset_key_map(uuid) to authenticated;
grant execute on function public.dataset_kpis(uuid) to authenticated;
grant execute on function public.time_series(uuid, text, text) to authenticated;
grant execute on function public.compare_periods(uuid, text, text) to authenticated;
grant execute on function public.rank_samples(uuid, jsonb, text, text, int, text) to authenticated;
grant execute on function public.refund_rate(uuid, jsonb) to authenticated;
grant execute on function public.concentration(uuid, jsonb, int) to authenticated;
grant execute on function public.time_pattern(uuid, jsonb, text) to authenticated;
grant execute on function public.branch_ranking(uuid) to authenticated;
grant execute on function public.quality_profile(uuid, jsonb) to authenticated;

-- ---------- Analysis-in-report ----------
-- Appends a dataset analysis snapshot as an 'insight' component of a report.
-- Superadmin-only (matches publish_report/snapshot_report_kpis).
create or replace function public.add_analysis_component(
  p_report_id uuid,
  p_dataset_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_analysis record;
  v_exists boolean;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  select organization_id into v_org from public.reports where id = p_report_id;
  if v_org is null then
    raise exception 'REPORT_NOT_FOUND';
  end if;

  select dataset_id, markdown into v_analysis
    from public.dataset_analyses
   where dataset_id = p_dataset_id;
  if v_analysis.dataset_id is null then
    raise exception 'ANALYSIS_NOT_FOUND';
  end if;

  select exists(
    select 1 from public.report_applications ra
     join public.application_files af on af.application_id = ra.application_id
     join public.datasets d on d.id = af.dataset_id
     where ra.report_id = p_report_id and af.dataset_id = p_dataset_id
     and d.deleted_at is null
  ) into v_exists;

  insert into public.report_components (report_id, kind, title, body)
  values (
    p_report_id,
    'insight',
    'SiroQ Analysis',
    jsonb_build_object('dataset_id', p_dataset_id, 'markdown', v_analysis.markdown, 'linked', coalesce(v_exists, false))
  );

  return true;
end;
$$;

grant execute on function public.add_analysis_component(uuid, uuid) to authenticated;