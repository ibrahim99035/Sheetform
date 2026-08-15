-- ============================================================
-- SiroQ Phase 3 fix — compare_periods ambiguous column
-- The v1 fix used `jsonb_build_object('label', label, ...)`
-- where `label` matched the function's own OUT column name,
-- producing "column reference is ambiguous". Alias the inner
-- subquery columns and reference them through the alias.
-- ============================================================

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

grant execute on function public.compare_periods(uuid, text, text) to authenticated;