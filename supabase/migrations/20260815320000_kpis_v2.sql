-- ============================================================
-- SiroQ Phase 3 fix — dataset_kpis expense accumulator
-- The original declared `v_exp text` twice: once as the column
-- key lookup string and again as the numeric expense accumulator
-- target of the dynamic SUM. The second declaration won the type
-- lottery at runtime (text), so `coalesce(v_exp, 0)` failed with
-- "COALESCE types text and integer cannot be matched". Re-create
-- the function with a distinct numeric accumulator `v_expense`.
-- ============================================================

create or replace function public.dataset_kpis(p_dataset_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_template text;
  v_defs jsonb;
  v_map jsonb;
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
      * public._sf_to_num(data->>' || quote_literal(v_price) || '))'
      || coalesce(' - sum(public._sf_to_num(data->>' || quote_literal(v_refund) || '))', '') || ', 0)';
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

grant execute on function public.dataset_kpis(uuid) to authenticated;