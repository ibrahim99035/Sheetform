-- ============================================================
-- Sheetform schema
-- Tables, helper functions, RPCs, RLS, storage, realtime
-- ============================================================

-- ---------- Tables ----------

create table public.datasets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  original_filename text not null,
  storage_path text not null,
  status text not null default 'pending'
    check (status in ('pending','processing','ready','error')),
  error_message text,
  row_count integer default 0,
  column_defs jsonb not null default '[]',
  sheet_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dataset_rows (
  id bigint generated always as identity primary key,
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  row_index integer not null,
  data jsonb not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (dataset_id, row_index)
);

create index idx_dataset_rows_dataset_id on public.dataset_rows(dataset_id);
create index idx_dataset_rows_data_gin on public.dataset_rows using gin (data);
create index idx_dataset_rows_not_deleted on public.dataset_rows(dataset_id, row_index)
  where deleted_at is null;

create table public.dataset_column_stats (
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  column_key text not null,
  min numeric,
  max numeric,
  avg numeric,
  sum numeric,
  distinct_count integer,
  null_count integer,
  computed_at timestamptz not null default now(),
  primary key (dataset_id, column_key)
);

create table public.dataset_operations (
  id bigint generated always as identity primary key,
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  operation_type text not null,
  payload jsonb not null,
  inverse_payload jsonb not null,
  applied_at timestamptz not null default now(),
  undone_at timestamptz
);

create index idx_dataset_operations_dataset_id on public.dataset_operations(dataset_id, applied_at desc);

-- ---------- Grants ----------

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.datasets to authenticated, service_role;
grant select, insert, update, delete on public.dataset_rows to authenticated, service_role;
grant select, insert, update, delete on public.dataset_column_stats to authenticated, service_role;
grant select, insert, update, delete on public.dataset_operations to authenticated, service_role;

-- ---------- Storage bucket + policies ----------

insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;

create policy "uploads read own" on storage.objects
  for select using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "uploads insert own" on storage.objects
  for insert with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "uploads update own" on storage.objects
  for update using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "uploads delete own" on storage.objects
  for delete using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Helper functions ----------

-- Resolve declared type for a column key from a column_defs array.
create or replace function public._sf_column_type(defs jsonb, key text)
returns text
language sql
stable
as $$
  select elem->>'type'
  from jsonb_array_elements(defs) elem
  where elem->>'key' = key
  limit 1;
$$;

-- Build a SQL boolean expression string for a view's filters.
-- Values/keys are embedded via quote_literal; keys are never used as
-- identifiers (only as jsonb object keys), so injection is not possible.
create or replace function public._sf_filter_condition(view jsonb, defs jsonb)
returns text
language plpgsql
stable
as $$
declare
  result text := 'true';
  f jsonb;
  key text;
  op text;
  value text;
  ctype text;
  expr text;
  num numeric;
  safe_num boolean;
begin
  if not jsonb_typeof(coalesce(view->'filters', '[]'::jsonb)) = 'array' then
    return result;
  end if;

  for f in select * from jsonb_array_elements(view->'filters') loop
    key := f->>'key';
    op := f->>'op';
    value := f->>'value';
    ctype := public._sf_column_type(defs, key);
    continue when ctype is null;

    expr := null;

    -- numeric comparison helpers
    if ctype = 'numeric' and op in ('gt','gte','lt','lte','equals') then
      safe_num := value ~ '^-?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?$';
      if safe_num and value <> '' then
        num := value::numeric;
      else
        continue;
      end if;
    end if;

    case ctype
      when 'string' then
        case op
          when 'contains' then
            expr := format('strpos(lower(coalesce(data->>%L, %L)), lower(%L)) > 0', key, '', value);
          when 'equals' then expr := format('data->>%L = %L', key, value);
          when 'not_equals' then expr := format('data->>%L is distinct from %L', key, value);
          when 'is_empty' then expr := format('coalesce(data->>%L, %L) = %L', key, '', '');
          when 'is_not_empty' then expr := format('coalesce(data->>%L, %L) <> %L', key, '', '');
          when 'gt' then expr := format('data->>%L > %L', key, value);
          when 'gte' then expr := format('data->>%L >= %L', key, value);
          when 'lt' then expr := format('data->>%L < %L', key, value);
          when 'lte' then expr := format('data->>%L <= %L', key, value);
        end case;
      when 'numeric' then
        case op
          when 'contains' then
            expr := format('strpos(data->>%L, %L) > 0', key, value);
          when 'equals' then expr := format('(data->>%L)::numeric = %s', key, num);
          when 'not_equals' then expr := format('(data->>%L)::numeric is distinct from %s', key, num);
          when 'gt' then expr := format('(data->>%L)::numeric > %s', key, num);
          when 'gte' then expr := format('(data->>%L)::numeric >= %s', key, num);
          when 'lt' then expr := format('(data->>%L)::numeric < %s', key, num);
          when 'lte' then expr := format('(data->>%L)::numeric <= %s', key, num);
          when 'is_empty' then expr := format('coalesce(data->>%L, %L) = %L', key, '', '');
          when 'is_not_empty' then expr := format('coalesce(data->>%L, %L) <> %L', key, '', '');
        end case;
      when 'date' then
        if op in ('gt','gte','lt','lte','equals') then
          if value = '' or (value::timestamptz) is null then
            continue;
          end if;
        end if;
        case op
          when 'contains' then
            expr := format('strpos(lower(coalesce(data->>%L, %L)), lower(%L)) > 0', key, '', value);
          when 'equals' then expr := format('(data->>%L)::timestamptz = %L', key, value::timestamptz);
          when 'not_equals' then expr := format('(data->>%L)::timestamptz is distinct from %L', key, value::timestamptz);
          when 'gt' then expr := format('(data->>%L)::timestamptz > %L', key, value::timestamptz);
          when 'gte' then expr := format('(data->>%L)::timestamptz >= %L', key, value::timestamptz);
          when 'lt' then expr := format('(data->>%L)::timestamptz < %L', key, value::timestamptz);
          when 'lte' then expr := format('(data->>%L)::timestamptz <= %L', key, value::timestamptz);
          when 'is_empty' then expr := format('coalesce(data->>%L, %L) = %L', key, '', '');
          when 'is_not_empty' then expr := format('coalesce(data->>%L, %L) <> %L', key, '', '');
        end case;
      when 'boolean' then
        case op
          when 'equals' then expr := format('data->>%L = %L', key, value);
          when 'not_equals' then expr := format('data->>%L is distinct from %L', key, value);
          when 'is_empty' then expr := format('coalesce(data->>%L, %L) = %L', key, '', '');
          when 'is_not_empty' then expr := format('coalesce(data->>%L, %L) <> %L', key, '', '');
        end case;
    end case;

    if expr is not null then
      result := result || ' and (' || expr || ')';
    end if;
  end loop;

  return result;
end;
$$;

-- Build a SQL order-by clause for a view's sort spec.
create or replace function public._sf_sort_clause(view jsonb, defs jsonb)
returns text
language plpgsql
stable
as $$
declare
  sort jsonb := view->'sort';
  key text;
  dir text;
  ctype text;
  expr text;
begin
  if sort is null or jsonb_typeof(sort) = 'null' then
    return 'row_index asc';
  end if;

  key := sort->>'key';
  dir := lower(coalesce(sort->>'dir', 'asc'));
  if dir <> 'desc' then dir := 'asc'; end if;
  ctype := public._sf_column_type(defs, key);
  if ctype is null then
    return 'row_index asc';
  end if;

  expr := case ctype
    when 'numeric' then format('(data->>%L)::numeric', key)
    when 'date' then format('(data->>%L)::timestamptz', key)
    else format('data->>%L', key)
  end;

  return format(
    '%s %s nulls %s, row_index %s',
    expr,
    dir,
    case when dir = 'asc' then 'last' else 'first' end,
    dir
  );
end;
$$;

-- Recompute stats for a single column of a dataset (aggregate over live rows).
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
    (dataset_id, column_key, min, max, avg, sum, distinct_count, null_count, computed_at)
  values
    (p_dataset_id, p_column_key, v_min, v_max, v_avg, v_sum, coalesce(v_distinct, 0), coalesce(v_null, 0), now())
  on conflict (dataset_id, column_key)
  do update set
    min = excluded.min, max = excluded.max, avg = excluded.avg, sum = excluded.sum,
    distinct_count = excluded.distinct_count, null_count = excluded.null_count,
    computed_at = excluded.computed_at;
end;
$$;

-- Rename a column in dataset_rows.data and datasets.column_defs.
create or replace function public._sf_rename_column(
  p_dataset_id uuid,
  p_old_key text,
  p_new_key text,
  p_new_label text
)
returns void
language plpgsql
security invoker
as $$
declare
  v_defs jsonb;
  v_new_defs jsonb;
  v_old_label text;
  v_old_type text;
begin
  select column_defs into v_defs from public.datasets where id = p_dataset_id;

  update public.dataset_rows
  set data = case
        when data ? p_old_key then jsonb_set(data - p_old_key, ('{' || p_new_key || '}')::text[], data->p_old_key)
        else data
      end
  where dataset_id = p_dataset_id;

  select elem->>'label', elem->>'type'
  into v_old_label, v_old_type
  from jsonb_array_elements(v_defs) elem
  where elem->>'key' = p_old_key
  limit 1;

  select jsonb_agg(
    case when (elem->>'key') = p_old_key then
      jsonb_build_object('key', p_new_key, 'label', p_new_label, 'type', elem->>'type')
    else elem end
    order by ord
  )
  into v_new_defs
  from jsonb_array_elements(v_defs) with ordinality as e(elem, ord);

  update public.datasets
  set column_defs = v_new_defs,
      updated_at = now()
  where id = p_dataset_id;
end;
$$;

-- ---------- Read RPCs ----------

-- Windowed, sorted, filtered row fetch for the virtualized table.
create or replace function public.get_dataset_rows(
  p_dataset_id uuid,
  p_view jsonb default '{}'::jsonb,
  p_page_size int default 200,
  p_page_offset bigint default 0
)
returns table (row_id bigint, row_index bigint, data jsonb)
language plpgsql
security invoker
stable
as $$
declare
  v_defs jsonb;
  v_cond text;
  v_order text;
  v_limit int;
begin
  select column_defs into v_defs from public.datasets where id = p_dataset_id;
  if v_defs is null then
    raise exception 'DATASET_NOT_FOUND';
  end if;

  v_cond := public._sf_filter_condition(coalesce(p_view, '{}'::jsonb), v_defs);
  v_order := public._sf_sort_clause(coalesce(p_view, '{}'::jsonb), v_defs);
  v_limit := greatest(1, least(p_page_size, 10000));

  return query execute format(
    'select id, row_index::bigint, data
       from public.dataset_rows
      where dataset_id = %L and deleted_at is null and (%s)
      order by %s
      limit %s offset %s',
    p_dataset_id, v_cond, v_order, v_limit, greatest(p_page_offset, 0)
  );
end;
$$;

-- Count rows matching a view (same filter logic).
create or replace function public.get_dataset_row_count(
  p_dataset_id uuid,
  p_view jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security invoker
stable
as $$
declare
  v_defs jsonb;
  v_cond text;
  v_count bigint;
begin
  select column_defs into v_defs from public.datasets where id = p_dataset_id;
  if v_defs is null then
    raise exception 'DATASET_NOT_FOUND';
  end if;

  v_cond := public._sf_filter_condition(coalesce(p_view, '{}'::jsonb), v_defs);

  execute format(
    'select count(*) from public.dataset_rows
      where dataset_id = %L and deleted_at is null and (%s)',
    p_dataset_id, v_cond
  ) into v_count;

  return v_count;
end;
$$;

-- ---------- Analyze RPC ----------

create or replace function public.group_by(
  p_dataset_id uuid,
  p_group_col text,
  p_agg_col text default null,
  p_agg_fn text default 'count',
  p_top_n int default 100,
  p_min_count int default 1
)
returns table (label text, value numeric, grp_count bigint)
language plpgsql
security invoker
stable
as $$
declare
  v_defs jsonb;
  v_agg_expr text;
  v_order_expr text;
  v_limit int;
begin
  select column_defs into v_defs from public.datasets where id = p_dataset_id;
  if v_defs is null then
    raise exception 'DATASET_NOT_FOUND';
  end if;

  if public._sf_column_type(v_defs, p_group_col) is null then
    raise exception 'INVALID_GROUP_COLUMN';
  end if;

  if p_agg_fn = 'count' then
    v_agg_expr := 'count(*)::numeric';
    v_order_expr := 'v_agg desc nulls last, cnt desc';
  else
    if p_agg_fn not in ('sum', 'avg') then
      raise exception 'INVALID_AGG';
    end if;
    if p_agg_col is null or public._sf_column_type(v_defs, p_agg_col) <> 'numeric' then
      raise exception 'INVALID_AGG_COLUMN';
    end if;
    v_agg_expr := format('(%s::numeric)', '(data->>' || quote_literal(p_agg_col) || ')::numeric');
    if p_agg_fn = 'sum' then
      v_agg_expr := 'sum(' || v_agg_expr || ')';
    else
      v_agg_expr := 'avg(' || v_agg_expr || ')';
    end if;
    v_order_expr := 'v_agg desc nulls last, cnt desc';
  end if;

  v_limit := greatest(1, least(coalesce(p_top_n, 100), 500));

  return query execute format(
    'select coalesce(data->>%L, %L) as label, %s as v_agg, count(*) as cnt
       from public.dataset_rows
      where dataset_id = %L and deleted_at is null
      group by data->>%L
     having count(*) >= %s
      order by %s
      limit %s',
    p_group_col, '',
    v_agg_expr,
    p_dataset_id,
    p_group_col,
    coalesce(p_min_count, 1),
    v_order_expr,
    v_limit
  );
end;
$$;

-- ---------- Transform RPCs ----------

-- Soft-delete rows that should disappear (used by filter_rows / dedupe).
create or replace function public._sf_soft_delete_rows(
  p_dataset_id uuid,
  p_row_ids bigint[]
)
returns void
language plpgsql
security invoker
as $$
begin
  update public.dataset_rows
  set deleted_at = now()
  where dataset_id = p_dataset_id and id = any(p_row_ids) and deleted_at is null;
end;
$$;

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
    -- p_params.filters :: same shape as view.filters
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
      -- build a jsonb_build_array partition key from the requested columns
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

grant execute on function public._sf_column_type(jsonb, text) to authenticated, anon;
grant execute on function public._sf_filter_condition(jsonb, jsonb) to authenticated, anon;
grant execute on function public._sf_sort_clause(jsonb, jsonb) to authenticated, anon;
grant execute on function public._sf_recompute_column_stats(uuid, text, text) to authenticated;
grant execute on function public._sf_rename_column(uuid, text, text, text) to authenticated;
grant execute on function public._sf_soft_delete_rows(uuid, bigint[]) to authenticated;
grant execute on function public.get_dataset_rows(uuid, jsonb, int, bigint) to authenticated, anon;
grant execute on function public.get_dataset_row_count(uuid, jsonb) to authenticated, anon;
grant execute on function public.group_by(uuid, text, text, text, int, int) to authenticated, anon;
grant execute on function public.apply_operation(uuid, text, jsonb) to authenticated;
grant execute on function public.undo_operation(uuid) to authenticated;
grant execute on function public.redo_operation(uuid) to authenticated;

-- ---------- RLS ----------

alter table public.datasets enable row level security;
create policy "owner full access" on public.datasets
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

alter table public.dataset_rows enable row level security;
create policy "owner via dataset" on public.dataset_rows
  for all using (
    dataset_id in (select id from public.datasets where owner_id = auth.uid())
  );

alter table public.dataset_column_stats enable row level security;
create policy "owner via dataset" on public.dataset_column_stats
  for all using (
    dataset_id in (select id from public.datasets where owner_id = auth.uid())
  );

alter table public.dataset_operations enable row level security;
create policy "owner via dataset" on public.dataset_operations
  for all using (
    dataset_id in (select id from public.datasets where owner_id = auth.uid())
  );

-- ---------- Realtime ----------

alter publication supabase_realtime add table public.datasets;