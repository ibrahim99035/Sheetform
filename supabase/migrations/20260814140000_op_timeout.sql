-- ============================================================
-- SiroQ mutation-ops timeout guard
--
-- Rename / undo / redo rewrite the dataset_rows JSONB table
-- (and recompute column stats) with a full-table pass. On hosted
-- instances the default statement_timeout (~8s) aborts these with
-- "canceling statement due to statement timeout" once a dataset
-- grows (observed on the 25,585-row health_indicators_egy seed).
-- The rename itself is O(rows) and correct; it just needs more
-- headroom. Each top-level mutation RPC raises the timeout to 2
-- minutes for its transaction only (is_local), so reads and light
-- RPCs keep the conservative default.
--
-- Should still be revisited when datasets grow to millions of
-- rows: a per-row column-key rewrite is not the long-term plan.
-- ============================================================

create or replace function public.apply_operation(
  p_dataset_id uuid,
  p_operation text,
  p_params jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_defs jsonb;
  v_uid uuid := auth.uid();
  v_message text := null;
  v_payload jsonb := '{}'::jsonb;
  v_inverse jsonb := '{}'::jsonb;
  v_new_defs jsonb;
  v_old_label text;
  v_old_type text;
  v_old_value jsonb;
  v_affected bigint := 0;
  v_op_id bigint;
  v_result jsonb;
  v_key text;
  v_newname text;
  v_match_ids bigint[];
  v_col_keys text[];
  v_k text;
  v_rank text;
  v_cond text;
begin
  perform set_config('statement_timeout', '120000', true);

  -- ownership check (RLS also applies, this is an explicit fast-path)
  select column_defs into v_defs
  from public.datasets
  where id = p_dataset_id
  limit 1;

  if v_defs is null then
    return '{"ok": false, "error": "Dataset not found"}'::jsonb;
  end if;

  if p_operation = 'rename_column' then
    v_key := p_params->>'old_key';
    if public._sf_column_type(v_defs, v_key) is null then
      return '{"ok": false, "error": "Column not found"}'::jsonb;
    end if;
    v_newname := p_params->>'new_key';
    if v_newname is null or v_newname = '' then
      return '{"ok": false, "error": "Missing new column name"}'::jsonb;
    end if;
    -- collision check
    if exists (
      select 1 from jsonb_array_elements(v_defs) elem
      where elem->>'key' = v_newname and elem->>'key' <> v_key
    ) then
      return '{"ok": false, "error": "Column name already in use"}'::jsonb;
    end if;

    select elem->>'label', elem->>'type' into v_old_label, v_old_type
    from jsonb_array_elements(v_defs) elem
    where elem->>'key' = v_key
    limit 1;

    perform public._sf_rename_column(
      p_dataset_id, v_key, v_newname,
      coalesce(p_params->>'new_label', v_old_label)
    );

    v_payload := jsonb_build_object(
      'old_key', v_key, 'new_key', v_newname,
      'new_label', coalesce(p_params->>'new_label', v_old_label)
    );
    v_inverse := jsonb_build_object(
      'old_key', v_newname, 'new_key', v_key, 'new_label', v_old_label
    );
    v_affected := 1;
    v_message := 'Column renamed';
  elsif p_operation = 'filter_rows' then
    if not jsonb_typeof(coalesce(p_params->'filters', '[]'::jsonb)) = 'array'
       or jsonb_array_length(p_params->'filters') = 0
    then
      return '{"ok": false, "error": "No filter criteria supplied"}'::jsonb;
    end if;
    v_cond := public._sf_filter_condition(jsonb_build_object('filters', p_params->'filters'), v_defs);
    execute format(
      'select array_agg(id) from public.dataset_rows
        where dataset_id = %L and deleted_at is null and (%s)',
      p_dataset_id, v_cond
    ) into v_match_ids;
    if v_match_ids is null or cardinality(v_match_ids) = 0 then
      return '{"ok": false, "error": "No rows match the filter", "affected": 0}'::jsonb;
    end if;
    perform public._sf_soft_delete_rows(p_dataset_id, v_match_ids);
    v_payload := jsonb_build_object('filters', p_params->'filters', 'label', p_params->>'label');
    v_inverse := jsonb_build_object('row_ids', v_match_ids);
    v_affected := cardinality(v_match_ids);
    v_message := v_affected::text || ' rows filtered';
  elsif p_operation = 'dedupe' then
    v_col_keys := coalesce(
      (select array_agg(elem) from jsonb_array_elements_text(p_params->'columns') elem),
      '{}'
    );
    if cardinality(v_col_keys) = 0 then
      v_rank := 'data';
    else
      v_rank := 'jsonb_build_array(' ||
        (select string_agg(format('data->>%L', k), ', ' order by ordinality)
         from unnest(v_col_keys) with ordinality as t(k, ordinality)) ||
        ')';
    end if;

    execute format(
      'select array_agg(id) from (
         select id,
                row_number() over (partition by %s order by row_index) as rn
           from public.dataset_rows
          where dataset_id = %L and deleted_at is null
       ) ranked where rn > 1',
      v_rank, p_dataset_id
    ) into v_match_ids;

    if v_match_ids is null or cardinality(v_match_ids) = 0 then
      return '{"ok": false, "error": "No duplicate rows found", "affected": 0}'::jsonb;
    end if;

    perform public._sf_soft_delete_rows(p_dataset_id, v_match_ids);
    v_payload := jsonb_build_object(
      'columns', coalesce(p_params->'columns', '[]'::jsonb),
      'label', p_params->>'label'
    );
    v_inverse := jsonb_build_object('row_ids', v_match_ids);
    v_affected := cardinality(v_match_ids);
    v_message := v_affected::text || ' duplicate rows removed';
  elsif p_operation = 'edit_cell' then
    v_key := p_params->>'column_key';
    if public._sf_column_type(v_defs, v_key) is null then
      return '{"ok": false, "error": "Column not found"}'::jsonb;
    end if;

    select data->v_key into v_old_value
    from public.dataset_rows
    where dataset_id = p_dataset_id and id = (p_params->>'row_id')::bigint
      and deleted_at is null
    for update;

    if not found then
      return '{"ok": false, "error": "Row not found"}'::jsonb;
    end if;

    update public.dataset_rows
    set data = jsonb_set(data, ('{' || v_key || '}')::text[], p_params->'new_value')
    where id = (p_params->>'row_id')::bigint and dataset_id = p_dataset_id;

    v_payload := jsonb_build_object(
      'row_id', (p_params->>'row_id')::bigint,
      'column_key', v_key,
      'new_value', p_params->'new_value'
    );
    v_inverse := jsonb_build_object(
      'row_id', (p_params->>'row_id')::bigint,
      'column_key', v_key,
      'old_value', v_old_value
    );
    v_affected := 1;
    v_message := 'Cell updated';
  else
    return jsonb_build_object('ok', false, 'error', 'Unknown operation: ' || p_operation);
  end if;

  insert into public.dataset_operations
    (dataset_id, user_id, operation_type, payload, inverse_payload)
  values (p_dataset_id, v_uid, p_operation, v_payload, v_inverse)
  returning id into v_op_id;

  -- recompute stats for affected column(s)
  if p_operation = 'edit_cell' then
    perform public._sf_recompute_column_stats(p_dataset_id, v_key, public._sf_column_type(v_defs, v_key));
  elsif p_operation in ('filter_rows', 'dedupe') then
    for v_k in select elem->>'key' from jsonb_array_elements(v_defs) elem loop
      perform public._sf_recompute_column_stats(p_dataset_id, v_k, public._sf_column_type(v_defs, v_k));
    end loop;
  elsif p_operation = 'rename_column' then
    perform public._sf_recompute_column_stats(p_dataset_id, v_newname, public._sf_column_type(v_defs, v_key));
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_op_id,
    'operation_type', p_operation,
    'affected', v_affected,
    'message', v_message
  );
end;
$$;

create or replace function public.undo_operation(p_dataset_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_op public.dataset_operations%rowtype;
  v_result jsonb;
  v_key text;
  v_old_label text;
  v_old_type text;
  v_defs jsonb;
  v_new_defs jsonb;
  v_new_label text;
begin
  perform set_config('statement_timeout', '120000', true);

  select * into v_op
  from public.dataset_operations
  where dataset_id = p_dataset_id and undone_at is null
  order by applied_at desc, id desc
  limit 1
  for update;

  if not found then
    return '{"ok": false, "error": "Nothing to undo"}'::jsonb;
  end if;

  case v_op.operation_type
    when 'edit_cell' then
      update public.dataset_rows
      set data = jsonb_set(data, ('{' || (v_op.inverse_payload->>'column_key') || '}')::text[], v_op.inverse_payload->'old_value')
      where id = (v_op.inverse_payload->>'row_id')::bigint and dataset_id = p_dataset_id;
      v_key := v_op.inverse_payload->>'column_key';
    when 'filter_rows', 'dedupe' then
      update public.dataset_rows
      set deleted_at = null
      where dataset_id = p_dataset_id
        and id = any(select (x)::bigint from jsonb_array_elements_text(v_op.inverse_payload->'row_ids') x)
        and deleted_at is not null;
      v_key := null;
    when 'rename_column' then
      perform public._sf_rename_column(
        p_dataset_id,
        v_op.inverse_payload->>'old_key',
        v_op.inverse_payload->>'new_key',
        v_op.inverse_payload->>'new_label'
      );
      v_key := v_op.inverse_payload->>'new_key';
    else
      return jsonb_build_object('ok', false, 'error', 'Cannot undo unknown operation');
  end case;

  update public.dataset_operations
  set undone_at = now()
  where id = v_op.id;

  select column_defs into v_defs from public.datasets where id = p_dataset_id;
  if v_key is not null then
    perform public._sf_recompute_column_stats(p_dataset_id, v_key, public._sf_column_type(v_defs, v_key));
  else
    for v_key in select elem->>'key' from jsonb_array_elements(v_defs) elem loop
      perform public._sf_recompute_column_stats(p_dataset_id, v_key, public._sf_column_type(v_defs, v_key));
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'id', v_op.id, 'operation_type', v_op.operation_type);
end;
$$;

create or replace function public.redo_operation(p_dataset_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_op public.dataset_operations%rowtype;
  v_res jsonb;
  v_key text;
  v_defs jsonb;
begin
  perform set_config('statement_timeout', '120000', true);

  select * into v_op
  from public.dataset_operations
  where dataset_id = p_dataset_id and undone_at is not null
  order by undone_at desc, id desc
  limit 1
  for update;

  if not found then
    return '{"ok": false, "error": "Nothing to redo"}'::jsonb;
  end if;

  -- replay the original operation using its stored payload
  v_res := public.apply_operation(
    p_dataset_id,
    v_op.operation_type,
    v_op.payload
  );

  if not (v_res->>'ok')::boolean then
    return v_res;
  end if;

  update public.dataset_operations
  set undone_at = null
  where id = v_op.id;

  -- if apply_operation inserted a NEW ops row, delete it; we keep the original
  delete from public.dataset_operations
  where id = (v_res->>'id')::bigint and id <> v_op.id;

  return jsonb_build_object('ok', true, 'id', v_op.id, 'operation_type', v_op.operation_type);
end;
$$;
