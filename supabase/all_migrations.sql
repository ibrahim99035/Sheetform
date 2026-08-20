-- ============================================================
-- Migration: 20260810180000_init.sql
-- ============================================================

-- ============================================================
-- SiroQ schema
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


-- ============================================================
-- Migration: 20260811120000_admin.sql
-- ============================================================

-- ============================================================
-- Superadmin: role table, helper function, RLS extensions, admin RPCs
-- ============================================================

-- ---------- admin_users table ----------

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.admin_users to authenticated, service_role;

alter table public.admin_users enable row level security;

drop policy if exists "admin reads own row" on public.admin_users;
create policy "admin reads own row" on public.admin_users
  for select using (user_id = auth.uid());

drop policy if exists "admin updates own row" on public.admin_users;
create policy "admin updates own row" on public.admin_users
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Elevation/deletion is only possible with the service role (scripts/add-admin.mjs).
-- No insert/delete RLS policies exist for authenticated users.

-- ---------- is_superadmin() ----------

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

grant execute on function public.is_superadmin() to authenticated;

-- ---------- Extend owner RLS with superadmin ----------
-- All app DB functions are SECURITY INVOKER and lean on RLS, so extending the
-- owner policies is enough to give superadmins full control of any dataset.

drop policy if exists "owner full access" on public.datasets;
create policy "owner full access" on public.datasets
  for all using (owner_id = auth.uid() or public.is_superadmin())
  with check (owner_id = auth.uid() or public.is_superadmin());

drop policy if exists "owner via dataset" on public.dataset_rows;
create policy "owner via dataset" on public.dataset_rows
  for all using (
    dataset_id in (select id from public.datasets where owner_id = auth.uid())
    or public.is_superadmin()
  );

drop policy if exists "owner via dataset" on public.dataset_column_stats;
create policy "owner via dataset" on public.dataset_column_stats
  for all using (
    dataset_id in (select id from public.datasets where owner_id = auth.uid())
    or public.is_superadmin()
  );

drop policy if exists "owner via dataset" on public.dataset_operations;
create policy "owner via dataset" on public.dataset_operations
  for all using (
    dataset_id in (select id from public.datasets where owner_id = auth.uid())
    or public.is_superadmin()
  );

-- Storage: superadmins may reach any user's uploaded originals.
drop policy if exists "uploads read own" on storage.objects;
create policy "uploads read own" on storage.objects
  for select using (
    bucket_id = 'uploads'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_superadmin())
  );

drop policy if exists "uploads insert own" on storage.objects;
create policy "uploads insert own" on storage.objects
  for insert with check (
    bucket_id = 'uploads'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_superadmin())
  );

drop policy if exists "uploads update own" on storage.objects;
create policy "uploads update own" on storage.objects
  for update using (
    bucket_id = 'uploads'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_superadmin())
  );

drop policy if exists "uploads delete own" on storage.objects;
create policy "uploads delete own" on storage.objects
  for delete using (
    bucket_id = 'uploads'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_superadmin())
  );

-- ---------- Admin RPCs ----------

create or replace function public.admin_list_users()
returns table (user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, dataset_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;
  return query
    select
      u.id as user_id,
      u.email::text as email,
      u.created_at,
      u.last_sign_in_at,
      (select count(*)::bigint from public.datasets d where d.owner_id = u.id) as dataset_count
    from auth.users u
    order by u.created_at desc;
end;
$$;

create or replace function public.admin_list_datasets(p_user_id uuid)
returns table (id uuid, name text, status text, row_count integer, sheet_name text, created_at timestamptz, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;
  return query
    select d.id, d.name, d.status, d.row_count, d.sheet_name, d.created_at, d.updated_at
    from public.datasets d
    where d.owner_id = p_user_id
    order by d.updated_at desc;
end;
$$;

grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_list_datasets(uuid) to authenticated;


-- ============================================================
-- Migration: 20260814120000_org_model.sql
-- ============================================================

-- ============================================================
-- SiroQ organization model
-- Organizations, profiles, branches, members, applications,
-- reports, report access control â€” plus the cutover of
-- dataset-table RLS to superadmin-only.
--
-- Design decisions (restrictive/secure options chosen, per plan):
--   * One org per user. create_owner / create_pharmacist reject a
--     user who already belongs to any organization.
--   * branch_scope is uuid[] (a pharmacist may be scoped to several
--     branches). Every element is validated against the org's branches
--     (RPC guard + a BEFORE trigger for defense in depth).
--   * Composite FK (organization_id, branch_id) -> branches(organization_id, id)
--     on applications and reports, so a branch reference can never point
--     at another org's branch. branch_id is nullable = org-wide.
--   * Orphan-row treatment: submitted applications whose datasets fail
--     import are NEVER auto-deleted â€” the dataset keeps its error_message
--     so the operator can see/retry it, and applications.status mirrors
--     datasets.status via a trigger. Deleting a branch that is referenced
--     by a member scope, application, or report is blocked instead of
--     silently leaving dangling references â€” enforced via RLS from
--     migration 20260814130000_org_fix.sql (a FIRST-version trigger was
--     replaced because it also blocked org cascade deletes).
--   * Report publishing: only a superadmin (operator) publishes; the org
--     must be active; a report requires at least one component or item;
--     every linked application must belong to the org. revise_report
--     replaces the report's content in place and bumps revised_at (no
--     version history â€” deliberately simple, more restrictive).
--   * Pharmacists may only submit applications for a branch inside their
--     own branch_scope; restricted report items are never visible to them.
--   * License: submit_org_profile and approve_organization both require
--     license_expiry >= current_date.
-- ============================================================

-- ---------- Tables ----------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'pending'
    check (status in ('pending','active','suspended','rejected')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.org_profile (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  pharmacy_name text not null,
  address text,
  phone text,
  license_no text not null,
  license_expiry date not null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  rejection_reason text,
  updated_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id) -- target for composite FKs
);

create table public.org_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer'
    check (role in ('owner','manager','pharmacist','viewer')),
  branch_scope uuid[] not null default '{}', -- empty = org-wide (owners/managers)
  is_primary_owner boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid, -- null = org-wide submission
  submitted_by uuid not null references auth.users(id) on delete restrict,
  title text not null,
  note text,
  status text not null default 'submitted'
    check (status in ('submitted','processing','ready','error','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id)
);

create table public.application_files (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  original_filename text not null,
  storage_path text not null,
  sheet_name text,
  column_defs jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (application_id, dataset_id)
);

create index idx_application_files_dataset_id on public.application_files(dataset_id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,
  title text not null,
  summary text,
  status text not null default 'draft'
    check (status in ('draft','published','revoked')),
  created_by uuid not null references auth.users(id),
  published_at timestamptz,
  revised_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id)
);

create table public.report_components (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text','chart','table','insight')),
  title text,
  body jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index idx_report_components_report_id on public.report_components(report_id, sort_order);

create table public.report_applications (
  report_id uuid not null references public.reports(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, application_id)
);

-- Deliverable insight lines with per-item access gating:
--   org       -> visible to every member of the org
--   branch    -> visible to members whose branch_scope intersects branch_ids
--   restricted-> owners/managers/superadmin only (never pharmacists)
create table public.report_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  component_id uuid references public.report_components(id) on delete set null,
  visibility text not null default 'org'
    check (visibility in ('org','branch','restricted')),
  branch_ids uuid[] not null default '{}',
  title text,
  body jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index idx_report_items_report_id on public.report_items(report_id, sort_order);

-- ---------- Grants ----------

grant select, insert, update, delete on public.organizations to authenticated, service_role;
grant select, insert, update, delete on public.org_profile to authenticated, service_role;
grant select, insert, update, delete on public.branches to authenticated, service_role;
grant select, insert, update, delete on public.org_members to authenticated, service_role;
grant select, insert, update, delete on public.applications to authenticated, service_role;
grant select, insert, update, delete on public.application_files to authenticated, service_role;
grant select, insert, update, delete on public.reports to authenticated, service_role;
grant select, insert, update, delete on public.report_components to authenticated, service_role;
grant select, insert, update, delete on public.report_applications to authenticated, service_role;
grant select, insert, update, delete on public.report_items to authenticated, service_role;

-- ---------- Helper functions ----------

-- All branch ids in p_branch_ids must belong to the given organization.
create or replace function public._sf_validate_branch_scope(p_org_id uuid, p_branch_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_branch_ids is null
    or cardinality(p_branch_ids) = 0
    or (
      select count(*) = cardinality(p_branch_ids)
      from unnest(p_branch_ids) b
      where exists (
        select 1 from public.branches br
        where br.id = b and br.organization_id = p_org_id
      )
    );
$$;

-- Defense in depth: keep branch_scope consistent even for direct inserts.
create or replace function public._sf_validate_org_members_branch_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.branch_scope is not null and not public._sf_validate_branch_scope(new.organization_id, new.branch_scope) then
    raise exception 'INVALID_BRANCH_SCOPE';
  end if;
  return new;
end;
$$;

create trigger trg_org_members_branch_scope
  before insert or update of branch_scope on public.org_members
  for each row execute function public._sf_validate_org_members_branch_scope();

-- Block deleting a branch that is still referenced (orphan treatment).
create or replace function public._sf_protect_branch_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.org_members m
    where m.organization_id = old.organization_id and old.id = any(m.branch_scope)
  ) or exists (
    select 1 from public.applications a where a.branch_id = old.id
  ) or exists (
    select 1 from public.reports r where r.branch_id = old.id
  ) or exists (
    select 1 from public.report_items i where old.id = any(i.branch_ids)
  ) then
    raise exception 'BRANCH_IN_USE';
  end if;
  return old;
end;
$$;

create trigger trg_protect_branch_refs
  before delete on public.branches
  for each row execute function public._sf_protect_branch_refs();

-- Whether the current user is a member of the given organization.
-- SECURITY DEFINER (reads org_members explicitly) so it can be used safely
-- from RLS policies on other org tables without recursion or RLS coupling.
create or replace function public._sf_is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members m
    where m.organization_id = p_org_id and m.user_id = auth.uid()
  );
$$;

-- Whether the current user is an owner/manager of the given organization.
create or replace function public._sf_is_org_manager(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members m
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.role in ('owner','manager')
  );
$$;

-- Keep applications.status in sync with the import pipeline's dataset status.
-- SECURITY DEFINER because it writes applications (which have no user-facing
-- update policy) on behalf of the datasets update. Internal-only: calling it
-- directly (no trigger row) is rejected.
create or replace function public._sf_sync_application_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op is null then
    raise exception 'FORBIDDEN';
  end if;
  update public.applications a
  set status = case new.status
        when 'ready' then 'ready'
        when 'error' then 'error'
        when 'processing' then 'processing'
        else 'submitted'
      end,
      updated_at = now()
  where a.id in (select f.application_id from public.application_files f where f.dataset_id = new.id);
  return new;
end;
$$;

create trigger trg_sync_application_status
  after update of status on public.datasets
  for each row execute function public._sf_sync_application_status();

-- Whether the current user may read the given report / report item.
-- SECURITY DEFINER: reads reports + org_members explicitly to avoid
-- relying on their own RLS policies (no recursion).
create or replace function public.effective_report_access(
  p_report_id uuid,
  p_visibility text default 'org',
  p_branch_ids uuid[] default '{}'::uuid[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_role text;
  v_scope uuid[];
  v_status text;
begin
  if public.is_superadmin() then
    return true;
  end if;

  select r.organization_id, r.status into v_org, v_status
  from public.reports r
  where r.id = p_report_id;

  if v_org is null then
    return false;
  end if;

  select m.role, coalesce(m.branch_scope, '{}'::uuid[]) into v_role, v_scope
  from public.org_members m
  where m.organization_id = v_org and m.user_id = auth.uid();

  if v_role is null then
    return false; -- not a member
  end if;

  if v_role in ('owner','manager') then
    return true;
  end if;

  -- Pharmacists only ever see published reports, and never restricted items.
  if v_status <> 'published' then
    return false;
  end if;

  if p_visibility = 'org' then
    return true;
  end if;

  if p_visibility = 'branch' then
    return exists (
      select 1 from unnest(coalesce(p_branch_ids, '{}'::uuid[])) b
      where b = any(v_scope)
    );
  end if;

  return false; -- 'restricted'
end;
$$;

-- ---------- RLS ----------

alter table public.organizations enable row level security;
create policy "org members read" on public.organizations
  for select using (
    public._sf_is_org_member(id)
    or public.is_superadmin()
  );
create policy "org owners update" on public.organizations
  for update using (
    public._sf_is_org_manager(id)
    or public.is_superadmin()
  );

alter table public.org_profile enable row level security;
create policy "org members read profile" on public.org_profile
  for select using (
    public._sf_is_org_member(organization_id)
    or public.is_superadmin()
  );
create policy "org owners write profile" on public.org_profile
  for all using (
    public._sf_is_org_manager(organization_id)
    or public.is_superadmin()
  )
  with check (
    public._sf_is_org_manager(organization_id)
    or public.is_superadmin()
  );

alter table public.branches enable row level security;
create policy "org members read branches" on public.branches
  for select using (
    public._sf_is_org_member(organization_id)
    or public.is_superadmin()
  );
create policy "org owners manage branches" on public.branches
  for all using (
    public._sf_is_org_manager(organization_id)
    or public.is_superadmin()
  )
  with check (
    public._sf_is_org_manager(organization_id)
    or public.is_superadmin()
  );

alter table public.org_members enable row level security;
-- A member sees only their own row; owners/managers/superadmins see the roster.
create policy "members read own membership" on public.org_members
  for select using (
    user_id = auth.uid()
    or public._sf_is_org_manager(organization_id)
    or public.is_superadmin()
  );
-- Writes happen exclusively through the SECURITY DEFINER RPCs
-- (create_owner, create_pharmacist, set_pharmacist_access).

alter table public.applications enable row level security;
create policy "org members read applications" on public.applications
  for select using (
    public._sf_is_org_member(organization_id)
    or public.is_superadmin()
  );
-- Writes happen exclusively through submit_application (SECURITY DEFINER);
-- status changes flow in from the datasets trigger.

alter table public.application_files enable row level security;
create policy "org members read files" on public.application_files
  for select using (
    public._sf_is_org_member(
      (select a.organization_id from public.applications a where a.id = application_id)
    )
    or public.is_superadmin()
  );

alter table public.reports enable row level security;
create policy "read by effective access" on public.reports
  for select using (public.effective_report_access(id));
-- Writes happen exclusively through publish_report / revise_report.

alter table public.report_components enable row level security;
create policy "read via report" on public.report_components
  for select using (
    report_id in (select r.id from public.reports r where public.effective_report_access(r.id))
  );

alter table public.report_applications enable row level security;
create policy "read via report" on public.report_applications
  for select using (
    report_id in (select r.id from public.reports r where public.effective_report_access(r.id))
  );

alter table public.report_items enable row level security;
create policy "read by effective access" on public.report_items
  for select using (
    public.effective_report_access(report_id, visibility, branch_ids)
  );

-- ---------- Dataset RLS cutover: superadmin-only ----------
-- The operator (superadmin) is now the only role that reads/writes dataset
-- tables directly; org users interact with data through applications and
-- reports. The import webhook runs as service_role (RLS bypassed). Regular
-- users' old /datasets pages go dark here; Phase 3 rewires them to
-- applications.

drop policy if exists "owner full access" on public.datasets;
create policy "admin full access" on public.datasets
  for all using (public.is_superadmin())
  with check (public.is_superadmin());

drop policy if exists "owner via dataset" on public.dataset_rows;
create policy "admin via dataset" on public.dataset_rows
  for all using (
    dataset_id in (select id from public.datasets)
    and public.is_superadmin()
  );

drop policy if exists "owner via dataset" on public.dataset_column_stats;
create policy "admin via dataset" on public.dataset_column_stats
  for all using (
    dataset_id in (select id from public.datasets)
    and public.is_superadmin()
  );

drop policy if exists "owner via dataset" on public.dataset_operations;
create policy "admin via dataset" on public.dataset_operations
  for all using (
    dataset_id in (select id from public.datasets)
    and public.is_superadmin()
  );

-- ---------- RPCs (SECURITY DEFINER; each self-guards) ----------

-- A freshly signed-up user claims a new organization as its primary owner.
create or replace function public.create_owner(p_org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN';
  end if;
  if p_org_name is null or btrim(p_org_name) = '' then
    raise exception 'INVALID_ORG_NAME';
  end if;
  -- One org per user (restrictive).
  if exists (select 1 from public.org_members where user_id = v_uid) then
    raise exception 'ALREADY_MEMBER';
  end if;

  insert into public.organizations (name, created_by)
  values (btrim(p_org_name), v_uid)
  returning id into v_org_id;

  insert into public.org_members (organization_id, user_id, role, is_primary_owner)
  values (v_org_id, v_uid, 'owner', true);

  return v_org_id;
end;
$$;

-- Owner/manager submits the org profile for review (or resubmits after rejection).
create or replace function public.submit_org_profile(
  p_org_id uuid,
  p_pharmacy_name text,
  p_license_no text,
  p_license_expiry date,
  p_address text default null,
  p_phone text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if not exists (
    select 1 from public.org_members
    where organization_id = p_org_id and user_id = v_uid and role in ('owner','manager')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_status from public.organizations where id = p_org_id;
  if v_status is null then
    raise exception 'ORG_NOT_FOUND';
  end if;
  if v_status = 'suspended' then
    raise exception 'ORG_SUSPENDED';
  end if;

  if p_pharmacy_name is null or btrim(p_pharmacy_name) = '' or p_license_no is null
     or btrim(p_license_no) = '' then
    raise exception 'INVALID_PROFILE';
  end if;
  if p_license_expiry < current_date then
    raise exception 'LICENSE_EXPIRED';
  end if;

  insert into public.org_profile (organization_id, pharmacy_name, license_no, license_expiry, address, phone)
  values (p_org_id, btrim(p_pharmacy_name), btrim(p_license_no), p_license_expiry, p_address, p_phone)
  on conflict (organization_id) do update set
    pharmacy_name = excluded.pharmacy_name,
    license_no = excluded.license_no,
    license_expiry = excluded.license_expiry,
    address = excluded.address,
    phone = excluded.phone,
    reviewed_at = null,
    reviewed_by = null,
    rejection_reason = null,
    updated_at = now();

  -- Reopen review for pending/rejected orgs.
  update public.organizations
  set status = 'pending', updated_at = now()
  where id = p_org_id and status in ('pending','rejected');
end;
$$;

create or replace function public.approve_organization(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_lic_exp date;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_status from public.organizations where id = p_org_id;
  if v_status is null then
    raise exception 'ORG_NOT_FOUND';
  end if;
  if v_status = 'active' then
    return; -- idempotent
  end if;

  select license_expiry into v_lic_exp from public.org_profile where organization_id = p_org_id;
  if v_lic_exp is null then
    raise exception 'PROFILE_MISSING';
  end if;
  if v_lic_exp < current_date then
    raise exception 'LICENSE_EXPIRED';
  end if;

  update public.org_profile
  set reviewed_at = now(), reviewed_by = auth.uid(), rejection_reason = null, updated_at = now()
  where organization_id = p_org_id;

  update public.organizations
  set status = 'active', updated_at = now()
  where id = p_org_id;
end;
$$;

create or replace function public.reject_organization(p_org_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  update public.org_profile
  set reviewed_at = now(), reviewed_by = auth.uid(), rejection_reason = p_reason, updated_at = now()
  where organization_id = p_org_id;

  update public.organizations
  set status = 'rejected', updated_at = now()
  where id = p_org_id;
end;
$$;

-- Attach an existing auth user to the org as a pharmacist.
-- The auth user itself is created by the app layer via the Supabase Admin
-- API (strong random username+password returned once, never stored in
-- plaintext); this RPC receives the resulting user_id.
create or replace function public.create_pharmacist(
  p_org_id uuid,
  p_user_id uuid,
  p_branch_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  select role into v_role from public.org_members
  where organization_id = p_org_id and user_id = v_uid;

  if v_role is null or v_role not in ('owner','manager') then
    if not public.is_superadmin() then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'USER_NOT_FOUND';
  end if;

  -- One org per user.
  if exists (select 1 from public.org_members where user_id = p_user_id) then
    raise exception 'ALREADY_MEMBER';
  end if;

  if not public._sf_validate_branch_scope(p_org_id, p_branch_ids) then
    raise exception 'INVALID_BRANCH_SCOPE';
  end if;

  insert into public.org_members (organization_id, user_id, role, branch_scope)
  values (p_org_id, p_user_id, 'pharmacist', coalesce(p_branch_ids, '{}'::uuid[]));
end;
$$;

-- Owner/manager narrows or widens a pharmacist's branch scope.
create or replace function public.set_pharmacist_access(
  p_org_id uuid,
  p_user_id uuid,
  p_branch_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  select role into v_role from public.org_members
  where organization_id = p_org_id and user_id = v_uid;

  if v_role is null or v_role not in ('owner','manager') then
    if not public.is_superadmin() then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  if not exists (
    select 1 from public.org_members
    where organization_id = p_org_id and user_id = p_user_id and role = 'pharmacist'
  ) then
    raise exception 'TARGET_NOT_PHARMACIST';
  end if;

  if not public._sf_validate_branch_scope(p_org_id, p_branch_ids) then
    raise exception 'INVALID_BRANCH_SCOPE';
  end if;

  update public.org_members
  set branch_scope = coalesce(p_branch_ids, '{}'::uuid[])
  where organization_id = p_org_id and user_id = p_user_id;
end;
$$;

-- Member submits a data application: creates a pending dataset (the import
-- webhook picks it up), an application record, and the file link.
create or replace function public.submit_application(
  p_org_id uuid,
  p_title text,
  p_original_filename text,
  p_storage_path text,
  p_column_defs jsonb default '[]'::jsonb,
  p_branch_id uuid default null,
  p_sheet_name text default null,
  p_note text default null
)
returns table (application_id uuid, dataset_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_scope uuid[];
  v_status text;
  v_app_id uuid;
  v_dataset_id uuid;
begin
  select m.role, coalesce(m.branch_scope, '{}'::uuid[]) into v_role, v_scope
  from public.org_members m
  where m.organization_id = p_org_id and m.user_id = v_uid;

  if v_role is null or v_role not in ('owner','manager','pharmacist') then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_status from public.organizations where id = p_org_id;
  if v_status is distinct from 'active' then
    raise exception 'ORG_NOT_ACTIVE';
  end if;

  if p_title is null or btrim(p_title) = '' or p_original_filename is null
     or p_storage_path is null then
    raise exception 'INVALID_APPLICATION';
  end if;

  if p_branch_id is not null then
    if not exists (select 1 from public.branches where id = p_branch_id and organization_id = p_org_id) then
      raise exception 'INVALID_BRANCH';
    end if;
    -- Pharmacists may only submit for a branch inside their own scope.
    if v_role = 'pharmacist' and not (p_branch_id = any(v_scope)) then
      raise exception 'FORBIDDEN';
    end if;
  else
    -- Pharmacists must scope submissions to one of their branches.
    if v_role = 'pharmacist' then
      raise exception 'BRANCH_REQUIRED';
    end if;
  end if;

  insert into public.datasets (owner_id, name, original_filename, storage_path, status, column_defs, sheet_name)
  values (v_uid, btrim(p_title), p_original_filename, p_storage_path, 'pending', coalesce(p_column_defs, '[]'), p_sheet_name)
  returning id into v_dataset_id;

  insert into public.applications (organization_id, branch_id, submitted_by, title, note)
  values (p_org_id, p_branch_id, v_uid, btrim(p_title), p_note)
  returning id into v_app_id;

  insert into public.application_files (application_id, dataset_id, original_filename, storage_path, sheet_name, column_defs)
  values (v_app_id, v_dataset_id, p_original_filename, p_storage_path, p_sheet_name, coalesce(p_column_defs, '[]'));

  return query select v_app_id, v_dataset_id;
end;
$$;

-- Operator publishes a report: components + access-gated items + source apps.
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

  insert into public.reports (organization_id, branch_id, title, summary, status, created_by, published_at)
  values (p_org_id, p_branch_id, btrim(p_title), p_summary, 'published', v_uid, now())
  returning id into v_report_id;

  v_sort := 0;
  for v_comp in select * from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) loop
    insert into public.report_components (report_id, kind, title, body, sort_order)
    values (
      v_report_id,
      coalesce(v_comp->>'kind', 'text'),
      v_comp->>'title',
      v_comp->'body',
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

-- Operator revises an existing published report in place (new revised_at).
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

  select organization_id, status into v_org, v_status from public.reports where id = p_report_id;
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
    insert into public.report_components (report_id, kind, title, body, sort_order)
    values (p_report_id, coalesce(v_comp->>'kind', 'text'), v_comp->>'title', v_comp->'body', v_sort);
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

-- ---------- Function grants ----------

grant execute on function public._sf_validate_branch_scope(uuid, uuid[]) to authenticated;
grant execute on function public._sf_is_org_member(uuid) to authenticated;
grant execute on function public._sf_is_org_manager(uuid) to authenticated;
grant execute on function public.effective_report_access(uuid, text, uuid[]) to authenticated;
grant execute on function public.create_owner(text) to authenticated;
grant execute on function public.submit_org_profile(uuid, text, text, date, text, text) to authenticated;
grant execute on function public.approve_organization(uuid) to authenticated;
grant execute on function public.reject_organization(uuid, text) to authenticated;
grant execute on function public.create_pharmacist(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.set_pharmacist_access(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.submit_application(uuid, text, text, text, jsonb, uuid, text, text) to authenticated;
grant execute on function public.publish_report(uuid, text, text, jsonb, jsonb, uuid[], uuid) to authenticated;
grant execute on function public.revise_report(uuid, text, text, jsonb, jsonb, uuid[], uuid) to authenticated;

-- ---------- Realtime ----------

alter publication supabase_realtime add table public.organizations;
alter publication supabase_realtime add table public.applications;
alter publication supabase_realtime add table public.reports;



-- ============================================================
-- Migration: 20260814130000_org_fix.sql
-- ============================================================

-- ============================================================
-- SiroQ org model fix: branch reference protection via RLS
--
-- The original org_model migration blocked deleting a referenced branch
-- with a BEFORE DELETE trigger (_sf_protect_branch_refs). That also fired
-- when an owner/superadmin deleted an organization (FK CASCADE to branches),
-- aborting the whole org delete. FK cascades bypass RLS, so moving the
-- protection into a DELETE RLS policy keeps direct deletes guarded while
-- allowing org cascades to proceed.
--
-- After this migration:
--   * Direct branch deletes (API/owner/superadmin) are blocked by RLS with
--     the row simply not matching the delete policy (restrictive: even
--     superadmins must unlink references first â€” mirror of BRANCH_IN_USE).
--   * Organization deletes cascade to branches as before.
-- ============================================================

drop trigger if exists trg_protect_branch_refs on public.branches;
drop function if exists public._sf_protect_branch_refs();

-- True if any member scope, application, report, or report item references
-- the branch. SECURITY DEFINER (reads those tables explicitly, no RLS coupling).
create or replace function public._sf_branch_in_use(p_branch_id uuid, p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members m
    where m.organization_id = p_org_id and p_branch_id = any(m.branch_scope)
  ) or exists (
    select 1 from public.applications a where a.branch_id = p_branch_id
  ) or exists (
    select 1 from public.reports r where r.branch_id = p_branch_id
  ) or exists (
    select 1 from public.report_items i where p_branch_id = any(i.branch_ids)
  );
$$;

-- Split the FOR ALL manage policy into per-command policies so DELETE can
-- additionally require the branch to be unreferenced.
drop policy if exists "org owners manage branches" on public.branches;

create policy "org owners insert branches" on public.branches
  for insert with check (
    public._sf_is_org_manager(organization_id)
    or public.is_superadmin()
  );

create policy "org owners update branches" on public.branches
  for update using (
    public._sf_is_org_manager(organization_id)
    or public.is_superadmin()
  )
  with check (
    public._sf_is_org_manager(organization_id)
    or public.is_superadmin()
  );

create policy "org owners delete unreferenced branches" on public.branches
  for delete using (
    (public._sf_is_org_manager(organization_id) or public.is_superadmin())
    and not public._sf_branch_in_use(id, organization_id)
  );

grant execute on function public._sf_branch_in_use(uuid, uuid) to authenticated;


-- ============================================================
-- Migration: 20260814140000_op_timeout.sql
-- ============================================================

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



-- ============================================================
-- Migration: 20260814150000_diag_timeout.sql
-- ============================================================

create or replace function public._diag_timeout()
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_before text;
  v_after text;
  v_src text;
begin
  v_before := current_setting('statement_timeout');
  perform set_config('statement_timeout', '120000', true);
  v_after := current_setting('statement_timeout');
  select prosrc into v_src from pg_proc where proname = 'apply_operation' limit 1;
  return jsonb_build_object(
    'before', v_before,
    'after', v_after,
    'apply_has_timeout', position('statement_timeout' in coalesce(v_src,'')) > 0,
    'apply_prosrc_len', length(coalesce(v_src,''))
  );
end;
$$;
grant execute on function public._diag_timeout() to authenticated;



-- ============================================================
-- Migration: 20260814150100_diag2.sql
-- ============================================================

create or replace function public._diag_timeout()
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_before text;
  v_after text;
  v_src text;
begin
  v_before := current_setting('statement_timeout');
  perform set_config('statement_timeout', '120000', true);
  v_after := current_setting('statement_timeout');
  select prosrc into v_src from pg_proc where proname = 'apply_operation' limit 1;
  return jsonb_build_object(
    'before', v_before,
    'after', v_after,
    'apply_has_timeout', position('statement_timeout' in coalesce(v_src,'')) > 0,
    'apply_prosrc_len', length(coalesce(v_src,''))
  );
end;
$$;
grant execute on function public._diag_timeout() to authenticated;



-- ============================================================
-- Migration: 20260814150200_diag3.sql
-- ============================================================

create or replace function public._diag_sleep(seconds double precision default 10)
returns text
language plpgsql
security invoker
as $$
begin
  perform set_config('statement_timeout', '120000', true);
  perform pg_sleep(seconds);
  return 'slept ' || seconds::text || 's ok';
end;
$$;
grant execute on function public._diag_sleep(double precision) to authenticated;



-- ============================================================
-- Migration: 20260814150300_diag4.sql
-- ============================================================

create or replace function public._diag_sleep2(seconds double precision default 10)
returns text
language plpgsql
security invoker
as $$
begin
  perform set_config('statement_timeout', '120000', false);
  perform pg_sleep(seconds);
  return 'slept ' || seconds::text || 's ok';
end;
$$;
grant execute on function public._diag_sleep2(double precision) to authenticated;



-- ============================================================
-- Migration: 20260814150400_op_timeout_role.sql
-- ============================================================

-- ============================================================
-- SiroQ mutation-ops timeout: role-level statement_timeout
--
-- A prior attempt (20260814140000_op_timeout.sql) set
-- statement_timeout inside the RPC bodies via set_config. That
-- cannot work: PostgREST runs each RPC as a single SELECT, and
-- Postgres snapshots statement_timeout at statement start, so
-- changing it mid-statement has no effect (observed: a 10s
-- pg_sleep after set_config is still cancelled at the ~8s
-- default). The timeout must be raised where it is in effect
-- before any statement begins: at the role.
--
-- Rename/undo/redo rewrite the dataset_rows JSONB table plus
-- recompute column stats; on the hosted instance that reliably
-- exceeds the ~8s default for datasets in the tens of thousands
-- of rows (health_indicators_egy: 25,585). Authenticated callers
-- (the operator UI) get 2 minutes; reads and light RPCs are
-- unaffected in practice. service_role keeps a sane default too
-- so import webhooks do not block the pool.
--
-- ALTER ROLE applies to sessions started after the change; the
-- pooler opens fresh connections for new requests, so the new
-- value takes effect immediately for client traffic.
-- ============================================================

alter role authenticated set statement_timeout = '2min';
alter role service_role set statement_timeout = '2min';



-- ============================================================
-- Migration: 20260814150500_diag5.sql
-- ============================================================

create or replace function public._diag_roles()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_auth text;
  v_svc text;
  v_dbsetting text;
begin
  select coalesce(array_to_string(rolconfig, ','), 'NONE') into v_auth
  from pg_roles where rolname = 'authenticated';
  select coalesce(array_to_string(rolconfig, ','), 'NONE') into v_svc
  from pg_roles where rolname = 'service_role';
  select coalesce(string_agg(setconfig::text, ' / '), 'NONE') into v_dbsetting
  from pg_db_role_setting
  where setrole = (select oid from pg_roles where rolname = 'authenticated');
  return jsonb_build_object(
    'auth_rolconfig', v_auth,
    'svc_rolconfig', v_svc,
    'auth_dbsetting', v_dbsetting,
    'mysettings', current_setting('statement_timeout')
  );
end;
$$;
grant execute on function public._diag_roles() to authenticated;



-- ============================================================
-- Migration: 20260814150600_diag6.sql
-- ============================================================

create or replace function public._diag_roles()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_auth text;
  v_svc text;
  v_dbsetting text;
begin
  select coalesce(array_to_string(rolconfig, ','), 'NONE') into v_auth
  from pg_roles where rolname = 'authenticated';
  select coalesce(array_to_string(rolconfig, ','), 'NONE') into v_svc
  from pg_roles where rolname = 'service_role';
  select coalesce(string_agg(setconfig::text, ' / '), 'NONE') into v_dbsetting
  from pg_db_role_setting
  where setrole = (select oid from pg_roles where rolname = 'authenticated');
  return jsonb_build_object(
    'auth_rolconfig', v_auth,
    'svc_rolconfig', v_svc,
    'auth_dbsetting', v_dbsetting,
    'mysettings', current_setting('statement_timeout')
  );
end;
$$;
grant execute on function public._diag_roles() to authenticated;



-- ============================================================
-- Migration: 20260815100000_hardening.sql
-- ============================================================

-- ============================================================
-- SiroQ production hardening
--   * Append-only audit log for sensitive actions.
--   * retry_import RPC (operator recovery of stuck/failed imports).
--
-- Design decisions:
--   * audit_log is APPEND-ONLY: authenticated users get select only
--     (RLS-scoped) and every write goes through the SECURITY DEFINER
--     append_audit(...) helper, so the recorded actor is always
--     auth.uid() and can't be forged. No update/delete grants exist
--     for end users; service_role may write for system events.
--   * Triggers record dataset status changes, application status
--     changes, report publishes/revisions/revocations, and org-profile
--     reviews. They run SECURITY DEFINER so the import webhook
--     (service_role) and RPC-driven changes are all captured.
--   * retry_import is superadmin-only and merely resets the dataset to
--     'pending'; re-invocation is driven by the operator UI, which
--     calls the import Edge Function with the webhook secret.
-- ============================================================

-- ---------- Append-only audit log ----------

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_log_created on public.audit_log(created_at desc);
create index idx_audit_log_actor on public.audit_log(actor_id);
create index idx_audit_log_org on public.audit_log(organization_id);
create index idx_audit_log_entity on public.audit_log(entity_type, entity_id);

grant select, insert on public.audit_log to service_role;
grant select on public.audit_log to authenticated;

alter table public.audit_log enable row level security;

create policy "audit read by operator or org member" on public.audit_log
  for select using (
    public.is_superadmin()
    or (organization_id is not null and public._sf_is_org_member(organization_id))
  );

-- Single write path: records the acting auth.uid() and returns the row id.
create or replace function public.append_audit(
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_org_id uuid default null
)
returns bigint
language sql
security definer
set search_path = public
as $$
  insert into public.audit_log (actor_id, organization_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), p_org_id, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
  returning id;
$$;

grant execute on function public.append_audit(text, text, text, jsonb, uuid) to authenticated;

-- ---------- Audit triggers ----------

create or replace function public._audit_dataset_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.status, '') is distinct from coalesce(new.status, '') then
    perform public.append_audit(
      'dataset_status',
      'datasets',
      new.id::text,
      jsonb_build_object('from', old.status, 'to', new.status, 'error_message', new.error_message, 'row_count', new.row_count)
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_dataset_status
  after update of status on public.datasets
  for each row execute function public._audit_dataset_status();

create or replace function public._audit_application_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.status, '') is distinct from coalesce(new.status, '') then
    perform public.append_audit(
      'application_status',
      'applications',
      new.id::text,
      jsonb_build_object('from', old.status, 'to', new.status),
      new.organization_id
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_application_status
  after update of status on public.applications
  for each row execute function public._audit_application_status();

create or replace function public._audit_report_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or coalesce(old.status, '') is distinct from coalesce(new.status, '')
     or coalesce(old.revised_at) is distinct from coalesce(new.revised_at)
  then
    perform public.append_audit(
      case when tg_op = 'INSERT' then 'report_published'
           when new.status = 'revoked' then 'report_revoked'
           else 'report_changed' end,
      'reports',
      new.id::text,
      jsonb_build_object('title', new.title, 'status', new.status, 'revised', new.revised_at is not null),
      new.organization_id
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_report_change
  after insert or update of status, revised_at on public.reports
  for each row execute function public._audit_report_change();

create or replace function public._audit_org_profile_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reviewed_at is not null then
    perform public.append_audit(
      'org_review',
      'org_profile',
      new.organization_id::text,
      jsonb_build_object('reviewed_by', new.reviewed_by, 'rejection_reason', new.rejection_reason)
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_org_profile_review
  after insert or update of reviewed_at on public.org_profile
  for each row execute function public._audit_org_profile_review();

-- ---------- retry_import ----------

-- Operator-only recovery: reset a stuck/failed dataset to 'pending' so the
-- import pipeline will process it again. The operator UI re-invokes the
-- Edge Function after this RPC; a new webhook is not required.
create or replace function public.retry_import(p_dataset_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_status from public.datasets where id = p_dataset_id;
  if v_status is null then
    raise exception 'DATASET_NOT_FOUND';
  end if;
  if v_status not in ('pending', 'error') then
    raise exception 'DATASET_NOT_RETRYABLE';
  end if;

  update public.datasets
  set status = 'pending', error_message = null, updated_at = now()
  where id = p_dataset_id;
end;
$$;

grant execute on function public.retry_import(uuid) to authenticated;


-- ============================================================
-- Migration: 20260815200000_org_workflow.sql
-- ============================================================

-- ============================================================
-- SiroQ Phase 2 â€” org workflow
--   * templates + template_columns (typed, role-mapped analysis)
--   * branch_profiles + branch licensing (pharmacies are branches)
--   * branch status lifecycle (pending/active/rejected/suspended)
--   * submit_application extended with template_code + license gate
--   * notifications table + helpers
--
-- Design decisions:
--   * Branch status derives from review: submit_branch_profile flips the
--     branch back to 'pending'; approve_pharmacy/reject_pharmacy set
--     'active'/'rejected'. Data submissions require an active branch with
--     an unexpired license in branch_profiles.
--   * template_columns carry a canonical "role" (product/qty/unit_price/
--     cost/date/...) so the Phase 3 KPI layer can compute metrics from any
--     conforming template. Storage keys in datasets.column_defs use the
--     template's canonical keys, so KPIs only need column-def lookup.
--   * Templates are a read-only catalog for authenticated users (no user
--     data); RLS select-only.
-- ============================================================

-- ---------- Templates ----------

create table public.templates (
  code text primary key,
  name text not null,
  description text,
  type text not null check (type in ('product','sales','financial','health')),
  sensitivity text not null default 'sales_financial'
    check (sensitivity in ('none','sales_financial','patient_health')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.template_columns (
  template_code text not null references public.templates(code) on delete cascade,
  key text not null,
  label text not null,
  type text not null default 'string' check (type in ('string','numeric','date','boolean')),
  required boolean not null default false,
  role text,
  created_at timestamptz not null default now(),
  primary key (template_code, key)
);

grant select on public.templates to authenticated;
grant select on public.template_columns to authenticated;

alter table public.templates enable row level security;
alter table public.template_columns enable row level security;
create policy "templates readable by authenticated" on public.templates
  for select using (true);
create policy "template columns readable by authenticated" on public.template_columns
  for select using (true);

-- Seed catalog (4 analysis templates)
insert into public.templates (code, name, description, type, sensitivity)
values
  ('sales', 'Monthly sales', 'Per-transaction sales: products sold, quantities, prices, costs.', 'sales', 'sales_financial'),
  ('product', 'Inventory / product', 'Product catalogue with units in stock, unit cost and price.', 'product', 'sales_financial'),
  ('financial', 'Financial statement', 'Revenue / expense lines with category and date.', 'financial', 'sales_financial'),
  ('health', 'Dispensing / patient', 'Dispensing records keyed to a patient identifier.', 'health', 'patient_health')
on conflict (code) do nothing;

insert into public.template_columns (template_code, key, label, type, required, role) values
  ('sales', 'date',          'Date',             'date',    true,  'date'),
  ('sales', 'branch',        'Branch',           'string',  false, 'branch'),
  ('sales', 'transaction_id','Transaction ID',   'string',  false, 'transaction_id'),
  ('sales', 'product',       'Product',          'string',  true,  'product'),
  ('sales', 'category',      'Category',         'string',  false, 'category'),
  ('sales', 'qty',           'Quantity',         'numeric', true,  'qty'),
  ('sales', 'unit_price',    'Unit price',       'numeric', true,  'unit_price'),
  ('sales', 'cost',          'Unit cost',        'numeric', false, 'cost'),
  ('sales', 'refund',        'Refund',           'numeric', false, 'refund'),
  ('product', 'product',     'Product',          'string',  true,  'product'),
  ('product', 'category',    'Category',         'string',  false, 'category'),
  ('product', 'sku',         'SKU',              'string',  false, 'sku'),
  ('product', 'stock_qty',   'Units in stock',   'numeric', false, 'qty'),
  ('product', 'unit_cost',   'Unit cost',        'numeric', false, 'cost'),
  ('product', 'unit_price',  'Unit price',       'numeric', false, 'unit_price'),
  ('financial', 'date',      'Date',             'date',    true,  'date'),
  ('financial', 'branch',    'Branch',           'string',  false, 'branch'),
  ('financial', 'category',  'Category',         'string',  false, 'category'),
  ('financial', 'account',   'Account',          'string',  false, 'account'),
  ('financial', 'revenue',   'Revenue',          'numeric', false, 'revenue'),
  ('financial', 'expense',   'Expense',          'numeric', false, 'expense'),
  ('financial', 'tax',       'Tax',              'numeric', false, 'tax'),
  ('health', 'patient_id',   'Patient ID',       'string',  true,  'patient'),
  ('health', 'date',         'Date',             'date',    true,  'date'),
  ('health', 'product',      'Product',          'string',  true,  'product'),
  ('health', 'qty',          'Quantity',         'numeric', true,  'qty'),
  ('health', 'unit_price',   'Unit price',       'numeric', true,  'unit_price'),
  ('health', 'cost',         'Unit cost',        'numeric', false, 'cost')
on conflict (template_code, key) do nothing;

-- ---------- Branch status + profiles ----------

alter table public.branches
  add column status text not null default 'pending'
    check (status in ('pending','active','rejected','suspended'));

create table public.branch_profiles (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pharmacy_name text not null,
  address text,
  phone text,
  license_no text not null,
  license_expiry date not null,
  delivery_email text,
  whatsapp text,
  email_delivery boolean not null default false,
  whatsapp_delivery boolean not null default false,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  rejection_reason text,
  updated_at timestamptz not null default now(),
  unique (organization_id, branch_id)
);

grant select, insert, update on public.branch_profiles to authenticated;
grant select, insert, update on public.branch_profiles to service_role;

alter table public.branch_profiles enable row level security;
create policy "org members read branch profiles" on public.branch_profiles
  for select using (
    public._sf_is_org_member(organization_id) or public.is_superadmin()
  );
create policy "org managers write branch profiles" on public.branch_profiles
  for all using (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  )
  with check (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  );

-- branches: owners/managers/superadmins manage status + profile state.
create policy "org managers update branch" on public.branches
  for update using (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  );

-- ---------- Branch workflow RPCs ----------

create or replace function public.submit_branch_profile(
  p_org_id uuid,
  p_branch_id uuid,
  p_pharmacy_name text,
  p_license_no text,
  p_license_expiry date,
  p_address text default null,
  p_phone text default null,
  p_delivery_email text default null,
  p_whatsapp text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.org_members
    where organization_id = p_org_id and user_id = auth.uid() and role in ('owner','manager')
  ) and not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  if not exists (
    select 1 from public.branches where id = p_branch_id and organization_id = p_org_id
  ) then
    raise exception 'BRANCH_NOT_FOUND';
  end if;

  if p_pharmacy_name is null or btrim(p_pharmacy_name) = '' or p_license_no is null
     or btrim(p_license_no) = '' then
    raise exception 'INVALID_PROFILE';
  end if;
  if p_license_expiry < current_date then
    raise exception 'LICENSE_EXPIRED';
  end if;

  insert into public.branch_profiles
    (branch_id, organization_id, pharmacy_name, license_no, license_expiry, address, phone, delivery_email, whatsapp)
  values
    (p_branch_id, p_org_id, btrim(p_pharmacy_name), btrim(p_license_no), p_license_expiry, p_address, p_phone, p_delivery_email, p_whatsapp)
  on conflict (branch_id) do update set
    pharmacy_name = excluded.pharmacy_name,
    license_no = excluded.license_no,
    license_expiry = excluded.license_expiry,
    address = excluded.address,
    phone = excluded.phone,
    delivery_email = excluded.delivery_email,
    whatsapp = excluded.whatsapp,
    reviewed_at = null,
    reviewed_by = null,
    rejection_reason = null,
    updated_at = now();

  update public.branches
  set status = 'pending', updated_at = now()
  where id = p_branch_id and status in ('pending','rejected','suspended');
end;
$$;

create or replace function public.approve_pharmacy(p_org_id uuid, p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lic date;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  select license_expiry into v_lic
  from public.branch_profiles where branch_id = p_branch_id and organization_id = p_org_id;
  if v_lic is null then
    raise exception 'PROFILE_MISSING';
  end if;
  if v_lic < current_date then
    raise exception 'LICENSE_EXPIRED';
  end if;

  update public.branch_profiles
  set reviewed_at = now(), reviewed_by = auth.uid(), rejection_reason = null, updated_at = now()
  where branch_id = p_branch_id and organization_id = p_org_id;

  update public.branches
  set status = 'active', updated_at = now()
  where id = p_branch_id and organization_id = p_org_id;
end;
$$;

create or replace function public.reject_pharmacy(
  p_org_id uuid,
  p_branch_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  update public.branch_profiles
  set reviewed_at = now(), reviewed_by = auth.uid(), rejection_reason = p_reason, updated_at = now()
  where branch_id = p_branch_id and organization_id = p_org_id;

  update public.branches
  set status = 'rejected', updated_at = now()
  where id = p_branch_id and organization_id = p_org_id;
end;
$$;

-- ---------- datasets: template link ----------

alter table public.datasets
  add column template_code text references public.templates(code);

-- ---------- submit_application (extended) ----------

drop function if exists public.submit_application(uuid, text, text, text, jsonb, uuid, text, text);

create or replace function public.submit_application(
  p_org_id uuid,
  p_title text,
  p_original_filename text,
  p_storage_path text,
  p_column_defs jsonb default '[]'::jsonb,
  p_branch_id uuid default null,
  p_sheet_name text default null,
  p_note text default null,
  p_template_code text default null
)
returns table (application_id uuid, dataset_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_scope uuid[];
  v_status text;
  v_branch_status text;
  v_lic date;
  v_template_active boolean;
  v_app_id uuid;
  v_dataset_id uuid;
begin
  select m.role, coalesce(m.branch_scope, '{}'::uuid[]) into v_role, v_scope
  from public.org_members m
  where m.organization_id = p_org_id and m.user_id = v_uid;

  if v_role is null or v_role not in ('owner','manager','pharmacist') then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_status from public.organizations where id = p_org_id;
  if v_status is distinct from 'active' then
    raise exception 'ORG_NOT_ACTIVE';
  end if;

  if p_title is null or btrim(p_title) = '' or p_original_filename is null
     or p_storage_path is null then
    raise exception 'INVALID_APPLICATION';
  end if;

  if p_template_code is not null then
    select active into v_template_active from public.templates where code = p_template_code;
    if v_template_active is not true then
      raise exception 'TEMPLATE_NOT_FOUND';
    end if;
  end if;

  if p_branch_id is not null then
    if not exists (select 1 from public.branches where id = p_branch_id and organization_id = p_org_id) then
      raise exception 'INVALID_BRANCH';
    end if;
    if v_role = 'pharmacist' and not (p_branch_id = any(v_scope)) then
      raise exception 'FORBIDDEN';
    end if;

    select b.status, bp.license_expiry into v_branch_status, v_lic
    from public.branches b
    left join public.branch_profiles bp on bp.branch_id = b.id and bp.organization_id = b.organization_id
    where b.id = p_branch_id and b.organization_id = p_org_id;

    if v_branch_status is distinct from 'active' then
      raise exception 'BRANCH_NOT_ACTIVE';
    end if;
    if v_lic is null or v_lic < current_date then
      raise exception 'LICENSE_EXPIRED';
    end if;
  else
    if v_role = 'pharmacist' then
      raise exception 'BRANCH_REQUIRED';
    end if;
  end if;

  insert into public.datasets (owner_id, name, original_filename, storage_path, status, column_defs, sheet_name, template_code)
  values (v_uid, btrim(p_title), p_original_filename, p_storage_path, 'pending', coalesce(p_column_defs, '[]'), p_sheet_name, p_template_code)
  returning id into v_dataset_id;

  insert into public.applications (organization_id, branch_id, submitted_by, title, note)
  values (p_org_id, p_branch_id, v_uid, btrim(p_title), p_note)
  returning id into v_app_id;

  insert into public.application_files (application_id, dataset_id, original_filename, storage_path, sheet_name, column_defs)
  values (v_app_id, v_dataset_id, p_original_filename, p_storage_path, p_sheet_name, coalesce(p_column_defs, '[]'));

  return query select v_app_id, v_dataset_id;
end;
$$;

grant execute on function public.submit_application(uuid, text, text, text, jsonb, uuid, text, text, text) to authenticated;
grant execute on function public.submit_branch_profile(uuid, uuid, text, text, date, text, text, text, text) to authenticated;
grant execute on function public.approve_pharmacy(uuid, uuid) to authenticated;
grant execute on function public.reject_pharmacy(uuid, uuid, text) to authenticated;

-- ---------- Notifications ----------

create table public.notifications (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_notifications_user on public.notifications(user_id, read_at, created_at desc);

grant select, insert, update on public.notifications to service_role;
grant select, update on public.notifications to authenticated;

alter table public.notifications enable row level security;
create policy "user reads own notifications" on public.notifications
  for select using (user_id = auth.uid() or public.is_superadmin());
create policy "user marks own notifications read" on public.notifications
  for update using (user_id = auth.uid() or public.is_superadmin());

-- Single write path (avoids granting insert to authenticated).
create or replace function public.notify_user(
  p_user_ids uuid[],
  p_kind text,
  p_title text,
  p_body text default null,
  p_payload jsonb default '{}'::jsonb,
  p_org_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_ids is null or cardinality(p_user_ids) = 0 then
    return;
  end if;
  insert into public.notifications (organization_id, user_id, kind, title, body, payload)
  select p_org_id, x, p_kind, p_title, p_body, coalesce(p_payload, '{}'::jsonb)
  from unnest(p_user_ids) x;
end;
$$;

grant execute on function public.notify_user(uuid[], text, text, text, jsonb, uuid) to service_role;

-- Applications ready/error notify the submitter and org owners/managers.
create or replace function public._notify_application_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_title text;
  v_body text;
begin
  if new.status in ('ready','error') and new.status <> coalesce(old.status, '') then
    v_kind := new.status;
    v_title := case when new.status = 'ready' then 'Data application processed'
                    else 'Data application failed' end;
    v_body := case when new.status = 'ready' then concat(new.title, ' is ready for analysis.')
                   else concat(new.title, ' failed to import. Please retry or contact support.') end;

    perform public.notify_user(
      array(select user_id from public.org_members
            where organization_id = new.organization_id and role in ('owner','manager'))
        || array[new.submitted_by],
      v_kind, v_title, v_body,
      jsonb_build_object('application_id', new.id), new.organization_id
    );
  end if;
  return new;
end;
$$;

create trigger trg_notify_application_status
  after update of status on public.applications
  for each row execute function public._notify_application_status();

-- Organization approval notifies the creator.
create or replace function public._notify_org_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    perform public.notify_user(
      array[new.created_by], 'org_approved', 'Organization approved',
      concat(new.name, ' is now active. You can manage branches and submit data.'),
      jsonb_build_object('organization_id', new.id), new.id
    );
  end if;
  return new;
end;
$$;

create trigger trg_notify_org_active
  after update of status on public.organizations
  for each row execute function public._notify_org_active();

-- Report publish / revoke notifies all org members.
create or replace function public._notify_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    perform public.notify_user(
      array(select user_id from public.org_members where organization_id = new.organization_id),
      'report_published', 'New report available', concat('A report on ', new.title, ' has been published.'),
      jsonb_build_object('report_id', new.id), new.organization_id
    );
  elsif new.status = 'revoked' and old.status is distinct from 'revoked' then
    perform public.notify_user(
      array(select user_id from public.org_members where organization_id = new.organization_id),
      'report_revoked', 'Report revoked', concat('The report ', new.title, ' has been revoked.'),
      jsonb_build_object('report_id', new.id), new.organization_id
    );
  end if;
  return new;
end;
$$;

create trigger trg_notify_report
  after update of status on public.reports
  for each row execute function public._notify_report();

alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.templates;
alter publication supabase_realtime add table public.branch_profiles;


-- ============================================================
-- Migration: 20260815210000_branch_updated_at.sql
-- ============================================================

-- ============================================================
-- SiroQ Phase 2 fix â€” branches.updated_at
-- submit_branch_profile / approve_pharmacy / reject_pharmacy set
-- updated_at on branches, but the Phase 1 branches table predates
-- org status lifecycle and has no updated_at column.
-- ============================================================

alter table public.branches
  add column updated_at timestamptz not null default now();


-- ============================================================
-- Migration: 20260815300000_analysis.sql
-- ============================================================

-- ============================================================
-- SiroQ Phase 3 â€” domain analysis engine
--   * _sf_to_num / _sf_to_ts guarded cast helpers
--   * _sf_template_key_map: template role -> storage key
--   * dataset_kpis(dataset)  -> one-row jsonb of KPIs
--   * time_series(dataset, metric, bucket) -> bucketed series
--
-- Design decisions:
--   * KPIs run over the LIVE dataset rows (soft-deletes and transforms
--     are honored, matching get_dataset_rows).
--   * All column references come from template_columns roles through
--     quote_literal'd keys â€” values only, never identifiers, so the
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


-- ============================================================
-- Migration: 20260815310000_analysis_fix.sql
-- ============================================================

-- ============================================================
-- SiroQ Phase 3 fix â€” compare_periods v2
-- Offers "latest period vs previous period" contrast by delegating
-- to time_series, so current/prior bucket selection, formatting and
-- null handling stay consistent with the series endpoint end-to-end.
-- (Original v1 compared the whole live range against the prior
--  window; that reading is replaced to match time_series buckets.)
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


-- ============================================================
-- Migration: 20260815320000_kpis_v2.sql
-- ============================================================

-- ============================================================
-- SiroQ Phase 3 fix â€” dataset_kpis expense accumulator
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


-- ============================================================
-- Migration: 20260815330000_compare_v2.sql
-- ============================================================

-- ============================================================
-- SiroQ Phase 3 fix â€” compare_periods ambiguous column
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


-- ============================================================
-- Migration: 20260815340000_rollup_snapshot_fix.sql
-- ============================================================

-- ============================================================
-- SiroQ Phase 3 fix â€” datasetâ†’org linkage
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


-- ============================================================
-- Migration: 20260815350000_snapshot_filter_fix.sql
-- ============================================================

-- ============================================================
-- SiroQ Phase 3 fix â€” snapshot_report_kpis dataset filter
-- `datasets.deleted_at` does not exist (deleted_at lives on
-- dataset_rows). Filter dataset candidates on status='ready'
-- instead, which is what the operator workbench treats as
-- snapshot-able input.
-- ============================================================

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
       and d.status = 'ready'
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

grant execute on function public.snapshot_report_kpis(uuid, text) to authenticated, service_role;


-- ============================================================
-- Migration: 20260815400000_deliveries.sql
-- ============================================================

-- ============================================================
-- SiroQ Phase 4 â€” report deliveries queue
--   * deliveries (rendered snapshot of a published report sent to
--     a branch's configured address via email and/or WhatsApp)
--   * queue_report_deliveries(report, kind): superadmin/operator
--     queues one delivery row per enabled recipient address from
--     branch_profiles (email_delivery / whatsapp_delivery flags)
--   * retry_deliveries(report): re-queues failed/skipped rows
--
-- Design decisions:
--   * The queue is push-based: worker claims a row (status â†’ processing)
--     and sets delivered/failed/skipped. Statuses:
--       queued â†’ processing â†’ delivered | failed | skipped
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


-- ============================================================
-- Migration: 20260815410000_queue_ok_boolean.sql
-- ============================================================

-- ============================================================
-- SiroQ Phase 4 fix â€” queue_report_deliveries boolean decl
-- v_org_status was declared `text` but the SELECT evaluates
-- `o.status = 'active'` (boolean), so `if not v_org_status`
-- failed with "argument of NOT must be type boolean, not type
-- text". Re-create with the correct boolean declaration.
-- ============================================================

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

grant execute on function public.queue_report_deliveries(uuid, text) to authenticated;


-- ============================================================
-- Migration: 20260815500000_compliance.sql
-- ============================================================

-- ============================================================
-- SiroQ Phase 5 â€” compliance: classification, retention, DSR, terms
--   * retention_policies: months per template sensitivity class
--   * purge_expired / purge_dataset: retention enforcement RPCs
--     (superadmin) + pg_cron job registration (hosted Supabase)
--   * subject_requests: data-subject requests (export / delete)
--     with an operator processing RPC
--   * terms + terms_acceptances: versioned terms, accept RPC
--
-- Design decisions:
--   * Sensitivity already lives on templates (none / sales_financial /
--     patient_health) and is carried by datasets.template_code. A
--     dataset's retention months are resolved through that link.
--   * Purging is two-step and audit-backed: archive_dataset soft-freezes
--     a dataset (status â†’ 'purged'); purge_dataset hard-deletes rows +
--     stats + operations + storage object + dataset row once retention
--     elapsed. audit_log rows are never destroyed (append-only).
--   * Cron is optional: registration is guarded so migrations keep
--     working where pg_cron is absent.
-- ============================================================

-- ---------- Retention policies ----------

create table public.retention_policies (
  sensitivity text primary key check (sensitivity in ('none','sales_financial','patient_health')),
  retention_months integer not null check (retention_months >= 0), -- 0 = keep indefinitely
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.retention_policies (sensitivity, retention_months)
values
  ('none', 0),             -- no PII/regulated data: keep
  ('sales_financial', 36), -- sales/financial: 3 years
  ('patient_health', 72)   -- dispensing/patient: 6 years
on conflict (sensitivity) do nothing;

grant select on public.retention_policies to authenticated;

alter table public.retention_policies enable row level security;
create policy "retention policies readable" on public.retention_policies
  for select using (true);

-- Datasets get an explicit retention status.
alter table public.datasets
  drop constraint datasets_status_check,
  add constraint datasets_status_check
    check (status in ('pending','processing','ready','error','purged'));

-- Resolve a dataset's retention months (0 = keep) via its template.
create or replace function public._sf_retention_months(p_dataset_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select rp.retention_months
       from public.datasets d
       join public.templates t on t.code = d.template_code
       join public.retention_policies rp on rp.sensitivity = t.sensitivity
      where d.id = p_dataset_id and rp.enabled),
    0
  );
$$;

-- Datasets past their retention window (created_at anchored).
-- Includes already-archived (status 'purged') datasets so a real sweep can
-- finish what a dry sweep started; excludes only hard-deleted rows (gone).
create or replace function public._sf_purge_eligible(
  p_cutoff timestamptz default null,
  p_dataset_ids uuid[] default null
)
returns setof public.datasets
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_cutoff, now());
begin
  return query
    select d.*
      from public.datasets d
     where (p_dataset_ids is null or d.id = any(p_dataset_ids))
       and public._sf_retention_months(d.id) > 0
       and d.created_at < v_now - make_interval(months => public._sf_retention_months(d.id));
end;
$$;

-- Operator: freeze a dataset (soft). Audit via append_audit.
create or replace function public.archive_dataset(p_dataset_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  update public.datasets
     set status = 'purged', updated_at = now()
   where id = p_dataset_id and status <> 'purged';

  if found then
    perform public.append_audit(
      'dataset.purged',
      'datasets',
      p_dataset_id::text,
      jsonb_build_object('stage', 'archive', 'retention_months', public._sf_retention_months(p_dataset_id))
    );
  end if;
end;
$$;

-- Operator: hard delete a purged dataset (rows, stats, operations, object).
create or replace function public.purge_dataset(p_dataset_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_storage_path text;
  v_retention int;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  select status, storage_path, public._sf_retention_months(id)
    into v_status, v_storage_path, v_retention
    from public.datasets where id = p_dataset_id;
  if v_status is null then
    raise exception 'DATASET_NOT_FOUND';
  end if;
  if v_status <> 'purged' then
    raise exception 'NOT_PURGED';
  end if;
  if v_retention = 0 then
    raise exception 'KEEP_FOREVER';
  end if;

  perform public.append_audit(
    'dataset.purged',
    'datasets',
    p_dataset_id::text,
    jsonb_build_object('stage', 'hard_delete')
  );

  delete from public.dataset_operations where dataset_id = p_dataset_id;
  delete from public.dataset_column_stats where dataset_id = p_dataset_id;
  delete from public.dataset_rows where dataset_id = p_dataset_id;

  if v_storage_path is not null and v_storage_path <> '' then
    -- storage.delete() was removed from newer storage versions; modern storage
    -- requires the allow_delete_query escape hatch for direct SQL deletes.
    set local storage.allow_delete_query = 'true';
    delete from storage.objects
     where bucket_id = 'uploads' and name = any(string_to_array(v_storage_path, ','));
  end if;

  delete from public.datasets where id = p_dataset_id;
end;
$$;

-- One-shot purge sweep of everything currently eligible.
create or replace function public.purge_expired(
  p_cutoff timestamptz default null,
  p_purge boolean default true,
  p_dataset_ids uuid[] default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_id uuid;
  v_count int := 0;
  v_archived int := 0;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  select array_agg(id) into v_ids from public._sf_purge_eligible(p_cutoff, p_dataset_ids);
  if v_ids is null then
    return 0;
  end if;

  -- dry vs real: real mode also hard-purges whatever is eligible right now
  update public.datasets
     set status = 'purged', updated_at = now()
   where id = any(v_ids) and status <> 'purged';
  get diagnostics v_archived = row_count;

  perform public.append_audit(
    'retention.sweep',
    'datasets',
    null,
    jsonb_build_object('eligible', array_length(v_ids, 1), 'archived', v_archived, 'purge', p_purge)
  );

  if p_purge then
    for v_id in select unnest(v_ids) loop
      begin
        perform public.purge_dataset(v_id);
        v_count := v_count + 1;
      exception when others then
        null;
      end;
    end loop;
    return v_count;
  end if;

  return v_archived;
end;
$$;

grant execute on function public._sf_retention_months(uuid) to authenticated;
grant execute on function public.archive_dataset(uuid) to authenticated;
grant execute on function public.purge_dataset(uuid) to authenticated;
grant execute on function public.purge_expired(timestamptz, boolean, uuid[]) to authenticated;

-- ---------- Subject access requests (export / delete) ----------

create table public.subject_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,
  kind text not null check (kind in ('export','delete')),
  status text not null default 'new' check (status in ('new','processing','done','rejected')),
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references auth.users(id)
);

grant select on public.subject_requests to authenticated;
grant select, insert, update, delete on public.subject_requests to service_role;

alter table public.subject_requests enable row level security;
create policy "users read own requests" on public.subject_requests
  for select using (user_id = auth.uid() or public.is_superadmin());

-- Any user may request an account data export or account deletion.
create or replace function public.request_subject_action(
  p_kind text,
  p_note text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_id bigint;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN';
  end if;
  if p_kind not in ('export','delete') then
    raise exception 'INVALID_KIND';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  insert into public.subject_requests (user_id, user_email, kind, note)
  values (v_uid, v_email, p_kind, p_note)
  returning id into v_id;

  return v_id;
end;
$$;

-- Operator: process a request. export â†’ dump role-scoped data into payload;
-- delete â†’ purge the user's footprint (memberships, self-owned datasets/docs).
create or replace function public.process_subject_request(
  p_request_id bigint,
  p_decision text default 'done'  -- 'done' | 'rejected'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req record;
  v_data jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;
  if p_decision not in ('done','rejected') then
    raise exception 'INVALID_DECISION';
  end if;

  select * into v_req from public.subject_requests where id = p_request_id;
  if v_req is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if p_decision = 'rejected' then
    update public.subject_requests
       set status = 'rejected', processed_at = now(), processed_by = v_uid
     where id = p_request_id;
    perform public.append_audit('dsr.rejected', 'subject_requests', p_request_id::text);
    return;
  end if;

  if v_req.kind = 'export' then
    select jsonb_build_object(
      'user', jsonb_build_object('email', v_req.user_email),
      'memberships', coalesce((
        select jsonb_agg(sub) from (
          select m.organization_id, m.role, m.branch_scope
            from public.org_members m where m.user_id = v_req.user_id
        ) sub), '[]'::jsonb)
    ) into v_data;

    update public.subject_requests
       set status = 'done', payload = v_data, processed_at = now(), processed_by = v_uid
     where id = p_request_id;

    perform public.append_audit('dsr.export', 'subject_requests', p_request_id::text,
      jsonb_build_object('user', v_req.user_email));
  else
    -- delete: drop memberships + owned files; auth user removal is a manual ops step
    delete from public.org_members where user_id = v_req.user_id;

    update public.subject_requests
       set status = 'done', payload = '{"footprint":"removed"}'::jsonb, processed_at = now(), processed_by = v_uid
     where id = p_request_id;

    perform public.append_audit('dsr.delete', 'subject_requests', p_request_id::text,
      jsonb_build_object('user', v_req.user_email));
  end if;
end;
$$;

grant execute on function public.request_subject_action(text, text) to authenticated;
grant execute on function public.process_subject_request(bigint, text) to authenticated;

-- ---------- Terms of Service ----------

create table public.terms (
  id bigint generated always as identity primary key,
  version text not null unique,
  title text not null,
  body text not null,
  effective_from timestamptz not null default now(),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.terms_acceptances (
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_id bigint not null references public.terms(id) on delete cascade,
  accepted_at timestamptz not null default now(),
  primary key (user_id, terms_id)
);

grant select on public.terms to authenticated;
grant select, insert on public.terms_acceptances to authenticated;

alter table public.terms enable row level security;
create policy "terms readable" on public.terms for select using (true);
alter table public.terms_acceptances enable row level security;
create policy "users read own terms" on public.terms_acceptances
  for select using (user_id = auth.uid() or public.is_superadmin());

-- Current active terms (for the consent banner).
create or replace function public.current_terms()
returns public.terms
language sql
stable
security invoker
as $$
  select * from public.terms where active order by effective_from desc limit 1;
$$;

-- Whether the current user must accept the active terms.
create or replace function public.terms_pending()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_terms_id bigint;
  v_accepted boolean;
begin
  select id into v_terms_id from public.terms where active order by effective_from desc limit 1;
  if v_terms_id is null then
    return false;
  end if;
  select exists (
    select 1 from public.terms_acceptances where user_id = v_uid and terms_id = v_terms_id
  ) into v_accepted;
  return not coalesce(v_accepted, false);
end;
$$;

-- Accept current terms.
create or replace function public.accept_terms()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_terms_id bigint;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN';
  end if;
  select id into v_terms_id from public.terms where active order by effective_from desc limit 1;
  if v_terms_id is null then
    raise exception 'NO_TERMS';
  end if;
  insert into public.terms_acceptances (user_id, terms_id)
  values (v_uid, v_terms_id)
  on conflict do nothing;
end;
$$;

grant execute on function public.current_terms() to authenticated;
grant execute on function public.terms_pending() to authenticated;
grant execute on function public.accept_terms() to authenticated;

-- Seed the first Terms version.
insert into public.terms (version, title, body, effective_from, active) values
  ('2026-08-01', 'Terms of Service v1',
   'SiroQ processes pharmacy data on behalf of your organization. Data is stored at rest and transmitted in transit in accordance with the platform security policy. Privacy policy: personal data is limited to what is required for account and delivery operation; you may request a copy or deletion of your data at any time.',
   now(), true)
on conflict (version) do nothing;

-- ---------- pg_cron (optional) ----------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'schedule' and pronamespace = to_regnamespace('cron')::oid) then
    perform cron.schedule(
      'siroq-retention-sweep',
      '0 3 * * 0', -- weekly Sunday 03:00
      'select public.purge_expired()'
    );
  end if;
exception when others then
  null;
end;
$$;


-- ============================================================
-- Migration: 20260816100000_application_add_file.sql
-- ============================================================

-- Multi-file applications: attach another file (=> new dataset) to an
-- existing application. Mirrors submit_application's guards:
--   * caller must be an active org member (owner/manager/pharmacist);
--   * org must be active; template must exist & be active;
--   * a pharmacist may only add to an application whose branch is in scope
--     and whose branch/org are active with a non-expired license.
--
-- Each added file becomes its own pending `datasets` row + `application_files`
-- row, exactly like submit_application. The import pipeline picks up the new
-- pending dataset through the same webhook as a first file.

create or replace function public.add_application_file(
  p_application_id uuid,
  p_original_filename text,
  p_storage_path text,
  p_column_defs jsonb default '[]'::jsonb,
  p_sheet_name text default null,
  p_template_code text default null
)
returns table (application_id uuid, dataset_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_branch uuid;
  v_role text;
  v_scope uuid[];
  v_status text;
  v_branch_status text;
  v_lic date;
  v_template_active boolean;
  v_dataset_id uuid;
begin
  select a.organization_id, a.branch_id into v_org, v_branch
  from public.applications a
  where a.id = p_application_id;

  if v_org is null then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;

  select m.role, coalesce(m.branch_scope, '{}'::uuid[]) into v_role, v_scope
  from public.org_members m
  where m.organization_id = v_org and m.user_id = v_uid;

  if v_role is null or v_role not in ('owner','manager','pharmacist') then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_status from public.organizations where id = v_org;
  if v_status is distinct from 'active' then
    raise exception 'ORG_NOT_ACTIVE';
  end if;

  if p_original_filename is null or p_storage_path is null then
    raise exception 'INVALID_APPLICATION';
  end if;

  if p_template_code is not null then
    select active into v_template_active from public.templates where code = p_template_code;
    if v_template_active is not true then
      raise exception 'TEMPLATE_NOT_FOUND';
    end if;
  end if;

  if v_branch is not null then
    if v_role = 'pharmacist' and not (v_branch = any(v_scope)) then
      raise exception 'FORBIDDEN';
    end if;

    select b.status, bp.license_expiry into v_branch_status, v_lic
    from public.branches b
    left join public.branch_profiles bp
      on bp.branch_id = b.id and bp.organization_id = b.organization_id
    where b.id = v_branch and b.organization_id = v_org;

    if v_branch_status is distinct from 'active' then
      raise exception 'BRANCH_NOT_ACTIVE';
    end if;
    if v_lic is null or v_lic < current_date then
      raise exception 'LICENSE_EXPIRED';
    end if;
  else
    if v_role = 'pharmacist' then
      raise exception 'BRANCH_REQUIRED';
    end if;
  end if;

  insert into public.datasets (owner_id, name, original_filename, storage_path, status, column_defs, sheet_name, template_code)
  values (
    v_uid,
    btrim(regexp_replace(p_original_filename, '\.[^./]+$', '')),
    p_original_filename,
    p_storage_path,
    'pending',
    coalesce(p_column_defs, '[]'),
    p_sheet_name,
    p_template_code
  )
  returning id into v_dataset_id;

  insert into public.application_files (application_id, dataset_id, original_filename, storage_path, sheet_name, column_defs)
  values (p_application_id, v_dataset_id, p_original_filename, p_storage_path, p_sheet_name, coalesce(p_column_defs, '[]'));

  return query select p_application_id, v_dataset_id;
end;
$$;

grant execute on function public.add_application_file(uuid, text, text, jsonb, text, text) to authenticated;

-- Rename / re-note an application (title + note editable after submission).
-- Guarded to active org members of the application's org.
create or replace function public.rename_application(
  p_application_id uuid,
  p_title text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_role text;
begin
  select organization_id into v_org from public.applications where id = p_application_id;
  if v_org is null then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'INVALID_APPLICATION';
  end if;

  select role into v_role from public.org_members m
  where m.organization_id = v_org and m.user_id = v_uid;

  if v_role is null or v_role not in ('owner','manager','pharmacist') then
    raise exception 'FORBIDDEN';
  end if;

  update public.applications
  set title = btrim(p_title),
      note = p_note,
      updated_at = now()
  where id = p_application_id;
end;
$$;

grant execute on function public.rename_application(uuid, text, text) to authenticated;


-- ============================================================
-- Migration: 20260816110000_component_visibility.sql
-- ============================================================

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


-- ============================================================
-- Migration: 20260816120000_analysis_engine.sql
-- ============================================================

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
-- quote_literal (values only, never identifiers) â€” same rule as the
-- existing KPI layer. New RPCs are security invoker; the operator is
-- the only role with read access to dataset tables.
-- ============================================================

-- ---------- Hardened numeric cast ----------
-- Handles: "â‚¬12,50" -> 12.50, "1.234,56" -> 1234.56, "12 500.00" -> 12500,
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
            from (select unnest(array['â‚¬','$','Â£','â‚º','Ø±.Ø³',' Ø¯.Ù…']) as sym) s
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


-- ============================================================
-- Migration: 20260816130000_app_centric.sql
-- ============================================================

-- ============================================================
-- SiroQ application-centric workspace
--
-- 1) report_blocks: persisted building-block draft per application.
--    Superadmin-writable so the operator collects analysis/chart/table/
--    insight blocks in the application workspace and later publishes them
--    into real report_components.
--
-- 2) add_column operation on apply_operation / undo_operation: lets the
--    operator add a computed (derived numeric) column from a formula over
--    existing numeric columns, or a blank typed column to fill in later.
--    Fully undoable/redoable like every other transform-tape op.
--
-- 3) Filter-aware analysis: optional p_view (view.filters) threaded into
--    group_by + engine analysis RPCs so building blocks reflect the active
--    view filter (all new params default empty -> existing callers unaffected).
--
-- 4) Superadmin bypass on add_application_file so an operator can attach a
--    dataset file to any application.
-- ============================================================

-- ---------- 1) report_blocks ----------

create table if not exists public.report_blocks (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  kind text not null check (kind in ('chart','table','insight','text')),
  title text not null default '',
  body jsonb not null default '{}'::jsonb,
  chart_type text check (chart_type in ('bar','line','area','pie')),
  branch_ids uuid[] not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists report_blocks_application_idx
  on public.report_blocks (application_id, sort_order);

grant select, insert, update, delete on public.report_blocks to authenticated, service_role;

alter table public.report_blocks enable row level security;

drop policy if exists "report blocks are superadmin-only" on public.report_blocks;
create policy "report blocks are superadmin-only"
  on public.report_blocks
  for all
  using (public.is_superadmin())
  with check (public.is_superadmin());

create or replace function public.add_report_block(
  p_application_id uuid,
  p_kind text,
  p_title text default '',
  p_body jsonb default '{}'::jsonb,
  p_chart_type text default null,
  p_branch_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_sort int;
  v_block_id uuid;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;
  if p_kind not in ('chart','table','insight','text') then
    raise exception 'INVALID_KIND';
  end if;
  if not exists (select 1 from public.applications where id = p_application_id) then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;
  if p_chart_type is not null and p_chart_type not in ('bar','line','area','pie') then
    raise exception 'INVALID_CHART_TYPE';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_sort
  from public.report_blocks where application_id = p_application_id;

  insert into public.report_blocks
    (application_id, kind, title, body, chart_type, branch_ids, sort_order)
  values
    (p_application_id, p_kind, coalesce(p_title, ''), coalesce(p_body, '{}'::jsonb),
     p_chart_type, coalesce(p_branch_ids, '{}'::uuid[]), v_sort)
  returning id into v_block_id;

  return v_block_id;
end;
$$;

grant execute on function public.add_report_block(uuid, text, text, jsonb, text, uuid[]) to authenticated;

create or replace function public.reorder_report_blocks(
  p_application_id uuid,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i int;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;
  if p_ordered_ids is null then
    return;
  end if;
  for i in 1..cardinality(p_ordered_ids) loop
    update public.report_blocks
       set sort_order = i - 1, updated_at = now()
     where id = p_ordered_ids[i] and application_id = p_application_id;
  end loop;
end;
$$;

grant execute on function public.reorder_report_blocks(uuid, uuid[]) to authenticated;

create or replace function public.delete_report_block(p_block_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;
  delete from public.report_blocks where id = p_block_id;
end;
$$;

grant execute on function public.delete_report_block(uuid) to authenticated;

-- ---------- 4) superadmin bypass on add_application_file ----------

create or replace function public.add_application_file(
  p_application_id uuid,
  p_original_filename text,
  p_storage_path text,
  p_column_defs jsonb default '[]'::jsonb,
  p_sheet_name text default null,
  p_template_code text default null
)
returns table (application_id uuid, dataset_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_branch uuid;
  v_role text;
  v_scope uuid[];
  v_status text;
  v_branch_status text;
  v_lic date;
  v_template_active boolean;
  v_dataset_id uuid;
  v_super boolean;
begin
  select a.organization_id, a.branch_id into v_org, v_branch
  from public.applications a
  where a.id = p_application_id;

  if v_org is null then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;

  v_super := public.is_superadmin();

  select m.role, coalesce(m.branch_scope, '{}'::uuid[]) into v_role, v_scope
  from public.org_members m
  where m.organization_id = v_org and m.user_id = v_uid;

  if (v_role is null or v_role not in ('owner','manager','pharmacist')) and not v_super then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_status from public.organizations where id = v_org;
  if v_status is distinct from 'active' and not v_super then
    raise exception 'ORG_NOT_ACTIVE';
  end if;

  if p_original_filename is null or p_storage_path is null then
    raise exception 'INVALID_APPLICATION';
  end if;

  if p_template_code is not null then
    select active into v_template_active from public.templates where code = p_template_code;
    if v_template_active is not true then
      raise exception 'TEMPLATE_NOT_FOUND';
    end if;
  end if;

  if not v_super and v_branch is not null then
    if v_role = 'pharmacist' and not (v_branch = any(v_scope)) then
      raise exception 'FORBIDDEN';
    end if;

    select b.status, bp.license_expiry into v_branch_status, v_lic
    from public.branches b
    left join public.branch_profiles bp
      on bp.branch_id = b.id and bp.organization_id = b.organization_id
    where b.id = v_branch and b.organization_id = v_org;

    if v_branch_status is distinct from 'active' then
      raise exception 'BRANCH_NOT_ACTIVE';
    end if;
    if v_lic is null or v_lic < current_date then
      raise exception 'LICENSE_EXPIRED';
    end if;
  elsif not v_super then
    if v_role = 'pharmacist' then
      raise exception 'BRANCH_REQUIRED';
    end if;
  end if;

  insert into public.datasets (owner_id, name, original_filename, storage_path, status, column_defs, sheet_name, template_code)
  values (
    v_uid,
    btrim(regexp_replace(p_original_filename, '\.[^./]+$', '')),
    p_original_filename,
    p_storage_path,
    'pending',
    coalesce(p_column_defs, '[]'),
    p_sheet_name,
    p_template_code
  )
  returning id into v_dataset_id;

  insert into public.application_files (application_id, dataset_id, original_filename, storage_path, sheet_name, column_defs)
  values (p_application_id, v_dataset_id, p_original_filename, p_storage_path, p_sheet_name, coalesce(p_column_defs, '[]'));

  return query select p_application_id, v_dataset_id;
end;
$$;

grant execute on function public.add_application_file(uuid, text, text, jsonb, text, text) to authenticated;

-- ---------- 2) add_column operation ----------

-- Derive a safe storage key for a new column from a display label.
create or replace function public._sf_make_column_key(p_label text)
returns text
language plpgsql
immutable
as $$
declare
  k text;
begin
  k := lower(regexp_replace(btrim(coalesce(p_label, '')), '[^a-zA-Z0-9_]+', '_', 'g'));
  k := regexp_replace(k, '^[0-9]+', '', 'g');
  return k;
end;
$$;

-- Parse a numeric formula over existing numeric columns into a SQL
-- expression of the form (data->>'key')::numeric <op> (data->>'key')::numeric.
-- Only column keys, numeric literals, and + - * / ( ) are accepted; anything
-- else raises INVALID_FORMULA. Also enforces well-formedness (no two
-- operands adjacent, no dangling operators).
create or replace function public._sf_column_formula_expr(
  p_defs jsonb,
  p_formula text
)
returns text
language plpgsql
immutable
as $$
declare
  toks text[];
  t text;
  prev text := '';
  out_expr text := '';
  n int := 1;
begin
  if p_formula is null or btrim(p_formula) = '' then
    raise exception 'INVALID_FORMULA';
  end if;
  select array_agg(m[1]) into toks
    from regexp_matches(coalesce(p_formula, ''), E'([a-zA-Z_][a-zA-Z0-9_]*|[0-9]+(\\.[0-9]+)?|\\.|\\(|\\)|[+*/-])', 'g') as m;
  if array_length(toks, 1) is null then
    raise exception 'INVALID_FORMULA';
  end if;

  foreach t in array toks loop
    if t ~ '^[a-zA-Z_]' then
      if public._sf_column_type(p_defs, t) is distinct from 'numeric' then
        raise exception 'INVALID_FORMULA_COLUMN';
      end if;
      if prev = 'operand' then
        raise exception 'INVALID_FORMULA';
      end if;
      out_expr := out_expr || '(data->>' || quote_literal(t) || ')::numeric';
      prev := 'operand';
    elsif t ~ '^[0-9]' or t = '.' then
      if prev = 'operand' then
        raise exception 'INVALID_FORMULA';
      end if;
      out_expr := out_expr || t;
      prev := 'operand';
    elsif t in ('+','-','*','/') then
      if prev <> 'operand' then
        raise exception 'INVALID_FORMULA';
      end if;
      out_expr := out_expr || ' ' || t || ' ';
      prev := 'op';
    elsif t = '(' then
      if prev = 'operand' then
        raise exception 'INVALID_FORMULA';
      end if;
      out_expr := out_expr || '(';
      prev := 'lp';
    elsif t = ')' then
      if prev = 'operand' then
        out_expr := out_expr || ')';
        prev := 'operand';
      else
        raise exception 'INVALID_FORMULA';
      end if;
    end if;
    n := n + 1;
  end loop;

  if prev <> 'operand' then
    raise exception 'INVALID_FORMULA';
  end if;
  return out_expr;
end;
$$;

-- Remove a column everywhere: defs, row data, and stats.
create or replace function public._sf_drop_column(p_dataset_id uuid, p_key text)
returns void
language plpgsql
security invoker
as $$
begin
  update public.datasets
     set column_defs = (
           select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
             from jsonb_array_elements(column_defs) with ordinality as t(e, ord)
            where e->>'key' <> p_key
         ),
         updated_at = now()
   where id = p_dataset_id;

  update public.dataset_rows
     set data = data - p_key
   where dataset_id = p_dataset_id;

  delete from public.dataset_column_stats
   where dataset_id = p_dataset_id and column_key = p_key;
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
  v_addkey text;
  v_addlabel text;
  v_addtype text;
  v_formula text;
  v_expr text;
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
  elsif p_operation = 'add_column' then
    v_addlabel := p_params->>'label';
    if v_addlabel is null or btrim(v_addlabel) = '' then
      return '{"ok": false, "error": "Missing column label"}'::jsonb;
    end if;
    v_addtype := coalesce(p_params->>'type', 'numeric');
    if v_addtype not in ('numeric','text','date','boolean') then
      return '{"ok": false, "error": "Invalid column type"}'::jsonb;
    end if;
    v_addkey := p_params->>'key';
    if v_addkey is null or v_addkey = '' then
      v_addkey := public._sf_make_column_key(v_addlabel);
    end if;
    if v_addkey = '' or v_addkey !~ '^[a-z_][a-z0-9_]*$' then
      return '{"ok": false, "error": "Invalid column key"}'::jsonb;
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_defs) elem
      where elem->>'key' = v_addkey
    ) then
      return '{"ok": false, "error": "Column name already in use"}'::jsonb;
    end if;

    v_formula := p_params->>'formula';
    v_expr := null;
    if v_formula is not null and btrim(v_formula) <> '' then
      v_expr := public._sf_column_formula_expr(v_defs, v_formula);
    end if;

    -- blank typed column: nothing to backfill; values stay null until edit_cell.
    if v_expr is not null then
      execute format(
        'update public.dataset_rows
            set data = data || jsonb_build_object(%L, (%s)::numeric)
          where dataset_id = %L and deleted_at is null',
        v_addkey, v_expr, p_dataset_id
      );
    end if;

    -- append the def
    v_new_defs := v_defs || jsonb_build_object(
      'key', v_addkey,
      'label', btrim(v_addlabel),
      'type', case when v_expr is not null then 'numeric' else v_addtype end
    );
    update public.datasets
       set column_defs = v_new_defs, updated_at = now()
     where id = p_dataset_id;

    v_payload := jsonb_build_object(
      'label', btrim(v_addlabel),
      'key', v_addkey,
      'type', case when v_expr is not null then 'numeric' else v_addtype end,
      'formula', v_formula
    );
    v_inverse := jsonb_build_object('key', v_addkey);
    v_affected := 1;
    v_key := v_addkey;
    v_message := 'Column added';
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
  elsif p_operation = 'add_column' then
    perform public._sf_recompute_column_stats(p_dataset_id, v_addkey, public._sf_column_type(v_new_defs, v_addkey));
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
    when 'add_column' then
      perform public._sf_drop_column(p_dataset_id, v_op.inverse_payload->>'key');
      v_key := null;
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

-- ---------- 3) filter-aware analysis ----------
-- Add an optional p_view (view.filters) to the analysis RPCs so building
-- blocks reflect the active filter. All new params are defaulted to empty,
-- so existing callers keep working unchanged.

-- group_by -------------------------------------------------------------
drop function if exists public.group_by(uuid, text, text, text, int, int) cascade;
create or replace function public.group_by(
  p_dataset_id uuid,
  p_group_col text,
  p_agg_col text default null,
  p_agg_fn text default 'count',
  p_top_n int default 100,
  p_min_count int default 1,
  p_view jsonb default '{}'::jsonb
)
returns table (label text, value numeric, grp_count bigint)
language plpgsql
security invoker
stable
as $$
declare
  v_defs jsonb;
  v_cond text;
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

  v_cond := public._sf_filter_condition(coalesce(p_view, '{}'::jsonb), v_defs);

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
      where dataset_id = %L and deleted_at is null and (%s)
      group by data->>%L
     having count(*) >= %s
      order by %s
      limit %s',
    p_group_col, '',
    v_agg_expr,
    p_dataset_id,
    v_cond,
    p_group_col,
    coalesce(p_min_count, 1),
    v_order_expr,
    v_limit
  );
end;
$$;

-- dataset_kpis ---------------------------------------------------------
drop function if exists public.dataset_kpis(uuid) cascade;
create or replace function public.dataset_kpis(
  p_dataset_id uuid,
  p_view jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_defs jsonb;
  v_cond text;
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
  select column_defs into v_defs from public.datasets where id = p_dataset_id;
  if v_defs is null then
    return '{}'::jsonb;
  end if;
  v_map := public._sf_dataset_key_map(p_dataset_id);
  if v_map = '{}'::jsonb then
    return '{}'::jsonb;
  end if;

  v_cond := public._sf_filter_condition(coalesce(p_view, '{}'::jsonb), v_defs);

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
        || ' and deleted_at is null and (' || v_cond || ')';

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

-- time_series ----------------------------------------------------------
drop function if exists public.time_series(uuid, text, text) cascade;
create or replace function public.time_series(
  p_dataset_id uuid,
  p_metric text default 'revenue',
  p_bucket text default 'month',
  p_view jsonb default '{}'::jsonb
)
returns table (bucket text, value numeric)
language plpgsql
security invoker
stable
as $$
declare
  v_defs jsonb;
  v_cond text;
  v_map jsonb;
  v_qty text; v_price text; v_cost text; v_exp text; v_rev text; v_date text;
  v_fmt text;
  v_metric_expr text;
  v_sql text;
begin
  select column_defs into v_defs from public.datasets where id = p_dataset_id;
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

  v_cond := public._sf_filter_condition(coalesce(p_view, '{}'::jsonb), v_defs);

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
        || ' and deleted_at is null and (' || v_cond || ')'
        || ' and data->>' || quote_literal(v_date) || ' is not null'
        || ' group by 1 order by 1';

  return query execute v_sql;
end;
$$;

-- rank_samples ----------------------------------------------------------
drop function if exists public.rank_samples(uuid, jsonb, text, text, int, text) cascade;
create or replace function public.rank_samples(
  p_dataset_id uuid,
  p_roles jsonb default null,
  p_dimension text default 'product',
  p_metric text default 'revenue',
  p_n int default 10,
  p_dir text default 'desc',
  p_view jsonb default '{}'::jsonb
)
returns table (label text, value numeric, units numeric, grp_count bigint)
language plpgsql
security invoker
stable
as $$
declare
  v_defs jsonb;
  v_cond text;
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
  select column_defs into v_defs from public.datasets where id = p_dataset_id;
  if p_dimension = 'category' then v_gkey := v_roles->>'category';
  elsif p_dimension = 'product' then v_gkey := v_roles->>'product';
  else raise exception 'INVALID_DIMENSION'; end if;
  if v_gkey is null then
    raise exception 'NO_DIMENSION';
  end if;

  v_qty := v_roles->>'qty'; v_price := v_roles->>'unit_price';
  v_cost := v_roles->>'cost'; v_rev := v_roles->>'revenue';

  v_cond := public._sf_filter_condition(coalesce(p_view, '{}'::jsonb), v_defs);

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
      where dataset_id = %L and deleted_at is null and (%s)
        and data->>%L is not null
      group by data->>%L
      order by value %s, grp_count desc, label
      limit %s',
    v_gkey, v_metric_expr, v_units_expr, p_dataset_id, v_cond, v_gkey, v_gkey, v_order_dir, v_limit
  );

  return query execute v_sql;
end;
$$;

-- refund_rate -----------------------------------------------------------
drop function if exists public.refund_rate(uuid, jsonb) cascade;
create or replace function public.refund_rate(
  p_dataset_id uuid,
  p_roles jsonb default null,
  p_view jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_defs jsonb;
  v_cond text;
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
  select column_defs into v_defs from public.datasets where id = p_dataset_id;
  v_cond := public._sf_filter_condition(coalesce(p_view, '{}'::jsonb), v_defs);

  -- gross revenue
  if v_qty is not null and v_price is not null then
    v_sql := 'select coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_qty) || ')
      * public._sf_to_num(data->>' || quote_literal(v_price) || ')), 0)
      from public.dataset_rows where dataset_id = ' || quote_literal(p_dataset_id) || ' and deleted_at is null and (' || v_cond || ')';
    execute v_sql into v_gross;
  elsif v_rev is not null then
    v_sql := 'select coalesce(sum(public._sf_to_num(data->>' || quote_literal(v_rev) || ')), 0)
      from public.dataset_rows where dataset_id = ' || quote_literal(p_dataset_id) || ' and deleted_at is null and (' || v_cond || ')';
    execute v_sql into v_gross;
  end if;

  -- explicit refund column (values may be positive or negative amounts)
  if v_refund is not null then
    v_sql := format(
      'select abs(coalesce(sum(public._sf_to_num(data->>%L)), 0)),
              count(*) filter (where coalesce(public._sf_to_num(data->>%L),0) <> 0)
         from public.dataset_rows
        where dataset_id = %L and deleted_at is null and (%s)',
      v_refund, v_refund, p_dataset_id, v_cond
    );
    execute v_sql into v_refunds, v_refund_rows;
  end if;

  -- negative-quantity heuristic when no refund column exists
  if v_qty is not null then
    v_units_expr := 'public._sf_to_num(data->>' || quote_literal(v_qty) || ')';
    if v_price is not null then
      v_sql := 'select coalesce(abs(sum(' || v_units_expr || ' * public._sf_to_num(data->>'
        || quote_literal(v_price) || '))), 0), count(*) filter (where ' || v_units_expr || ' < 0)
        from public.dataset_rows where dataset_id = ' || quote_literal(p_dataset_id) || ' and deleted_at is null and (' || v_cond || ')';
    else
      v_sql := 'select coalesce(abs(sum(' || v_units_expr || ')), 0), count(*) filter (where '
        || v_units_expr || ' < 0)
        from public.dataset_rows where dataset_id = ' || quote_literal(p_dataset_id) || ' and deleted_at is null and (' || v_cond || ')';
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

-- concentration -----------------------------------------------------------
drop function if exists public.concentration(uuid, jsonb, int) cascade;
create or replace function public.concentration(
  p_dataset_id uuid,
  p_roles jsonb default null,
  p_n int default 20,
  p_view jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_defs jsonb;
  v_cond text;
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
  select column_defs into v_defs from public.datasets where id = p_dataset_id;
  v_cond := public._sf_filter_condition(coalesce(p_view, '{}'::jsonb), v_defs);
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
         where dataset_id = %L and deleted_at is null and (%s)
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
    v_gkey, v_metric_expr, p_dataset_id, v_cond, v_gkey, v_limit, v_limit
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

-- time_pattern -----------------------------------------------------------
drop function if exists public.time_pattern(uuid, jsonb, text) cascade;
create or replace function public.time_pattern(
  p_dataset_id uuid,
  p_roles jsonb default null,
  p_granularity text default 'dow',
  p_view jsonb default '{}'::jsonb
)
returns table (label text, value numeric, units numeric, grp_count bigint)
language plpgsql
security invoker
stable
as $$
declare
  v_defs jsonb;
  v_cond text;
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
  select column_defs into v_defs from public.datasets where id = p_dataset_id;
  v_cond := public._sf_filter_condition(coalesce(p_view, '{}'::jsonb), v_defs);

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
      where dataset_id = %L and deleted_at is null and (%s)
        and data->>%L is not null
        and public._sf_to_ts(data->>%L) is not null
      group by 1 order by %s',
    v_bucket_expr, v_metric_expr, v_units_expr, p_dataset_id, v_cond, v_date, v_date, v_order
  );

  return query execute v_sql;
end;
$$;

-- quality_profile -----------------------------------------------------------
drop function if exists public.quality_profile(uuid, jsonb) cascade;
create or replace function public.quality_profile(
  p_dataset_id uuid,
  p_roles jsonb default null,
  p_view jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_roles jsonb := coalesce(p_roles, public._sf_dataset_key_map(p_dataset_id));
  v_defs jsonb;
  v_cond text;
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
  v_cond := public._sf_filter_condition(coalesce(p_view, '{}'::jsonb), v_defs);

  execute format(
    'select count(*) from public.dataset_rows
      where dataset_id = %L and deleted_at is null and (%s)',
    p_dataset_id, v_cond
  ) into v_rows;
  v_rows := coalesce(v_rows, 0);

  for v_elem in select * from jsonb_array_elements(v_defs) loop
    v_key := v_elem->>'key';
    v_label := v_elem->>'label';
    v_type := v_elem->>'type';
    v_role := v_elem->>'role';
    v_conf := v_elem->>'role_confidence';

    select s.null_count, s.distinct_count, coalesce(s.invalid_count, 0) as invalid_count,
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
      execute format(
        'select count(*) from public.dataset_rows
          where dataset_id = %L and deleted_at is null and (%s)
            and public._sf_to_num(data->>%L) < 0',
        p_dataset_id, v_cond, v_key
      ) into v_neg;

      execute format(
        'select stddev(public._sf_to_num(data->>%L)),
                max(public._sf_to_num(data->>%L)),
                min(public._sf_to_num(data->>%L)),
                avg(public._sf_to_num(data->>%L))
           from public.dataset_rows
          where dataset_id = %L and deleted_at is null and (%s)',
        v_key, v_key, v_key, v_key, p_dataset_id, v_cond
      ) into v_std, v_stats.max, v_stats.min, v_stats.avg;

      if coalesce(v_std, 0) > 0 and v_stats.avg is not null then
        v_outlier := (v_stats.max is not null and v_stats.max > v_stats.avg + 4 * v_std)
                  or (v_stats.min is not null and v_stats.min < v_stats.avg - 4 * v_std);
      end if;
    elsif v_type = 'string' and v_role in ('product','category','branch') then
    end if;

    -- currency detection on string columns (raw symbols survive in strings)
    if v_type = 'string' then
      execute format(
        'select string_agg(sym, '', '' order by sym)
           from (
             select s.sym
               from (select unnest(array[''â‚¬'',''$'',''Â£'',''â‚º'',''Ø±.Ø³'','' Ø¯.Ù…'']) as sym) s
              where exists (
                select 1 from public.dataset_rows r
                 where r.dataset_id = %L and r.deleted_at is null
                   and r.data->>%L like ''%%'' || s.sym || ''%%''
                   and length(r.data->>%L) < 60
              )
              limit 3
           ) t',
        p_dataset_id, v_key, v_key
      ) into v_currency;
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

  select jsonb_agg(c) into v_cols from jsonb_array_elements(v_cols) c;

  return jsonb_build_object(
    'rows', v_rows,
    'columns', v_cols,
    'flags', v_flags
  );
end;
$$;



-- ============================================================
-- Migration: 20260818120000_benchmarking.sql
-- ============================================================

-- ============================================================
-- Phase 5 â€” Benchmarking uplink (opt-in, aggregates only)
--
-- The control plane only ever receives pre-computed daily/category
-- aggregates (kilobytes). Raw rows and patient identifiers NEVER leave
-- the client (lib/privacy.ts / lib/benchmark-sync.ts).
--
-- Tenant is polymorphic so BOTH org-scoped datasets (organization_id)
-- and operator/superadmin uploads (owner_id) can participate:
--   exactly one of organization_id / owner_id is set per row (CHECK).
-- RLS: org rows are scoped to org members (write: owners/managers);
--       owner rows are scoped to that auth user.
-- ============================================================

-- ---------- Org-level region metadata (market filtering source) ----------

alter table public.org_profile
  add column region text;

-- ---------- Daily aggregates ----------

create table public.daily_aggregates (
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  day date not null,
  branch text not null default '',           -- dataset branch label ('' = none)
  total_revenue numeric not null default 0,
  transaction_count integer not null default 0,
  units numeric not null default 0,
  distinct_products integer not null default 0,
  computed_at timestamptz not null default now(),
  constraint daily_aggregates_one_tenant check ((organization_id is null) <> (owner_id is null))
);

create unique index uq_daily_org on public.daily_aggregates (organization_id, day, branch)
  where organization_id is not null;
create unique index uq_daily_owner on public.daily_aggregates (owner_id, day, branch)
  where owner_id is not null;
create index idx_daily_aggregates_day on public.daily_aggregates(day);
create index idx_daily_aggregates_region_lookup on public.daily_aggregates(organization_id, day);

-- ---------- Monthly category benchmarks ----------

create table public.category_benchmarks (
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  month date not null,                       -- first day of month
  category text not null,
  avg_margin numeric,                        -- NULL when no cost column in source
  revenue numeric not null default 0,
  units numeric not null default 0,
  share_pct numeric,
  computed_at timestamptz not null default now(),
  constraint category_benchmarks_one_tenant check ((organization_id is null) <> (owner_id is null))
);

create unique index uq_cat_org on public.category_benchmarks (organization_id, month, category)
  where organization_id is not null;
create unique index uq_cat_owner on public.category_benchmarks (owner_id, month, category)
  where owner_id is not null;
create index idx_category_benchmarks_month on public.category_benchmarks(month);

-- ---------- Opt-in gate (default OFF, mirrors lib/types.ts BenchmarkOptIn) ----------

create table public.benchmark_opt_in (
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  region text,                               -- overrides org_profile.region when set
  opted_in_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint benchmark_opt_in_one_tenant check ((organization_id is null) <> (owner_id is null))
);

create unique index uq_optin_org on public.benchmark_opt_in (organization_id)
  where organization_id is not null;
create unique index uq_optin_owner on public.benchmark_opt_in (owner_id)
  where owner_id is not null;

-- ---------- Grants ----------

grant select, insert, update, delete on public.daily_aggregates to authenticated, service_role;
grant select, insert, update, delete on public.category_benchmarks to authenticated, service_role;
grant select, insert, update, delete on public.benchmark_opt_in to authenticated, service_role;

-- ---------- Row Level Security ----------

alter table public.daily_aggregates enable row level security;
alter table public.category_benchmarks enable row level security;
alter table public.benchmark_opt_in enable row level security;

create policy "org members read daily aggregates" on public.daily_aggregates
  for select using (
    public._sf_is_org_member(organization_id) or public.is_superadmin()
  );
create policy "org managers write daily aggregates" on public.daily_aggregates
  for all using (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  )
  with check (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  );
create policy "owner reads own daily aggregates" on public.daily_aggregates
  for select using (owner_id = auth.uid() or public.is_superadmin());
create policy "owner writes own daily aggregates" on public.daily_aggregates
  for all using (owner_id = auth.uid() or public.is_superadmin())
  with check (owner_id = auth.uid() or public.is_superadmin());

create policy "org members read category benchmarks" on public.category_benchmarks
  for select using (
    public._sf_is_org_member(organization_id) or public.is_superadmin()
  );
create policy "org managers write category benchmarks" on public.category_benchmarks
  for all using (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  )
  with check (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  );
create policy "owner reads own category benchmarks" on public.category_benchmarks
  for select using (owner_id = auth.uid() or public.is_superadmin());
create policy "owner writes own category benchmarks" on public.category_benchmarks
  for all using (owner_id = auth.uid() or public.is_superadmin())
  with check (owner_id = auth.uid() or public.is_superadmin());

create policy "org members read opt-in" on public.benchmark_opt_in
  for select using (
    public._sf_is_org_member(organization_id) or public.is_superadmin()
  );
create policy "org managers write opt-in" on public.benchmark_opt_in
  for all using (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  )
  with check (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  );
create policy "owner reads own opt-in" on public.benchmark_opt_in
  for select using (owner_id = auth.uid() or public.is_superadmin());
create policy "owner writes own opt-in" on public.benchmark_opt_in
  for all using (owner_id = auth.uid() or public.is_superadmin())
  with check (owner_id = auth.uid() or public.is_superadmin());

-- ---------- Upsert RPC (validates caller, then stores KB payload) ----------

create or replace function public.upsert_benchmark_aggregates(
  p_payload jsonb,
  p_org_id uuid default null,
  p_owner_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date;
  d record;
  c record;
begin
  -- Authorize: exactly one tenant axis, matching the caller.
  if (p_org_id is not null) = (p_owner_id is not null) then
    raise exception 'FORBIDDEN';
  end if;
  if p_org_id is not null and not (public._sf_is_org_manager(p_org_id) or public.is_superadmin()) then
    raise exception 'FORBIDDEN';
  end if;
  if p_owner_id is not null and not (auth.uid() = p_owner_id or public.is_superadmin()) then
    raise exception 'FORBIDDEN';
  end if;

  -- Daily aggregates.
  if p_owner_id is not null then
    for d in
      select * from jsonb_to_recordset(coalesce(p_payload -> 'days', '[]'::jsonb)) as t(
        day date, branch text, revenue numeric, transactions integer,
        units numeric, distinct_products integer)
    loop
      insert into public.daily_aggregates
        (organization_id, owner_id, day, branch, total_revenue, transaction_count, units, distinct_products)
      values (null, p_owner_id, d.day, coalesce(d.branch, ''), coalesce(d.revenue, 0),
              coalesce(d.transactions, 0), coalesce(d.units, 0), coalesce(d.distinct_products, 0))
      on conflict (owner_id, day, branch) where owner_id is not null do update set
        total_revenue = excluded.total_revenue,
        transaction_count = excluded.transaction_count,
        units = excluded.units,
        distinct_products = excluded.distinct_products,
        computed_at = now();
    end loop;
  else
    for d in
      select * from jsonb_to_recordset(coalesce(p_payload -> 'days', '[]'::jsonb)) as t(
        day date, branch text, revenue numeric, transactions integer,
        units numeric, distinct_products integer)
    loop
      insert into public.daily_aggregates
        (organization_id, owner_id, day, branch, total_revenue, transaction_count, units, distinct_products)
      values (p_org_id, null, d.day, coalesce(d.branch, ''), coalesce(d.revenue, 0),
              coalesce(d.transactions, 0), coalesce(d.units, 0), coalesce(d.distinct_products, 0))
      on conflict (organization_id, day, branch) where organization_id is not null do update set
        total_revenue = excluded.total_revenue,
        transaction_count = excluded.transaction_count,
        units = excluded.units,
        distinct_products = excluded.distinct_products,
        computed_at = now();
    end loop;
  end if;

  -- Monthly category benchmarks.
  v_month := date_trunc('month', (p_payload ->> 'computed_at')::timestamptz)::date;
  if p_owner_id is not null then
    for c in
      select * from jsonb_to_recordset(coalesce(p_payload -> 'categories', '[]'::jsonb)) as t(
        category text, revenue numeric, units numeric, share_pct numeric, margin_pct numeric)
    loop
      insert into public.category_benchmarks
        (organization_id, owner_id, month, category, avg_margin, revenue, units, share_pct)
      values (null, p_owner_id, v_month, c.category, c.margin_pct, coalesce(c.revenue, 0),
              coalesce(c.units, 0), c.share_pct)
      on conflict (owner_id, month, category) where owner_id is not null do update set
        avg_margin = excluded.avg_margin,
        revenue = excluded.revenue,
        units = excluded.units,
        share_pct = excluded.share_pct,
        computed_at = now();
    end loop;
  else
    for c in
      select * from jsonb_to_recordset(coalesce(p_payload -> 'categories', '[]'::jsonb)) as t(
        category text, revenue numeric, units numeric, share_pct numeric, margin_pct numeric)
    loop
      insert into public.category_benchmarks
        (organization_id, owner_id, month, category, avg_margin, revenue, units, share_pct)
      values (p_org_id, null, v_month, c.category, c.margin_pct, coalesce(c.revenue, 0),
              coalesce(c.units, 0), c.share_pct)
      on conflict (organization_id, month, category) where organization_id is not null do update set
        avg_margin = excluded.avg_margin,
        revenue = excluded.revenue,
        units = excluded.units,
        share_pct = excluded.share_pct,
        computed_at = now();
    end loop;
  end if;
end $$;

grant execute on function public.upsert_benchmark_aggregates(jsonb, uuid, uuid) to authenticated;

-- ---------- Opt-in RPC (single row per tenant, owner/manager-guarded) ----------

create or replace function public.set_benchmark_opt_in(
  p_enabled boolean,
  p_region text default null,
  p_org_id uuid default null,
  p_owner_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (p_org_id is not null) = (p_owner_id is not null) then
    raise exception 'FORBIDDEN';
  end if;
  if p_org_id is not null and not (public._sf_is_org_manager(p_org_id) or public.is_superadmin()) then
    raise exception 'FORBIDDEN';
  end if;
  if p_owner_id is not null and not (auth.uid() = p_owner_id or public.is_superadmin()) then
    raise exception 'FORBIDDEN';
  end if;

  if p_org_id is not null then
    insert into public.benchmark_opt_in (organization_id, enabled, region, opted_in_at, updated_at)
    values (p_org_id, p_enabled, nullif(btrim(coalesce(p_region, '')), ''), case when p_enabled then now() end, now())
    on conflict (organization_id) where organization_id is not null do update set
      enabled = excluded.enabled,
      region = excluded.region,
      opted_in_at = case when excluded.enabled then coalesce(benchmark_opt_in.opted_in_at, now()) else null end,
      updated_at = now();
  else
    insert into public.benchmark_opt_in (owner_id, enabled, region, opted_in_at, updated_at)
    values (p_owner_id, p_enabled, nullif(btrim(coalesce(p_region, '')), ''), case when p_enabled then now() end, now())
    on conflict (owner_id) where owner_id is not null do update set
      enabled = excluded.enabled,
      region = excluded.region,
      opted_in_at = case when excluded.enabled then coalesce(benchmark_opt_in.opted_in_at, now()) else null end,
      updated_at = now();
  end if;
end $$;

grant execute on function public.set_benchmark_opt_in(boolean, text, uuid, uuid) to authenticated;

-- ---------- Market benchmark RPC: AVERAGES ONLY, caller excluded ----------
-- Returns market aggregates across every other opted-in tenant in the region,
-- never raw rows and never per-tenant figures.

create or replace function public.get_market_benchmarks(p_region text, p_category text)
returns table (metric text, market_value numeric, sample_orgs bigint)
language sql
stable
security definer
set search_path = public
as $$
  select 'avg_daily_revenue', avg(da.total_revenue), count(distinct da.organization_id) + count(distinct da.owner_id)
  from public.daily_aggregates da
  join public.benchmark_opt_in oi on oi.enabled
    and (oi.organization_id = da.organization_id or oi.owner_id = da.owner_id)
  where oi.region = p_region
    and da.owner_id is distinct from auth.uid()
    and (da.organization_id is null or da.organization_id not in (
          select m.organization_id from public.org_members m where m.user_id = auth.uid()))
  union all
  select 'avg_daily_transactions', avg(da.transaction_count), count(distinct da.organization_id) + count(distinct da.owner_id)
  from public.daily_aggregates da
  join public.benchmark_opt_in oi on oi.enabled
    and (oi.organization_id = da.organization_id or oi.owner_id = da.owner_id)
  where oi.region = p_region
    and da.owner_id is distinct from auth.uid()
    and (da.organization_id is null or da.organization_id not in (
          select m.organization_id from public.org_members m where m.user_id = auth.uid()))
  union all
  select 'avg_category_margin', avg(cb.avg_margin), count(distinct cb.organization_id) + count(distinct cb.owner_id)
  from public.category_benchmarks cb
  join public.benchmark_opt_in oi on oi.enabled
    and (oi.organization_id = cb.organization_id or oi.owner_id = cb.owner_id)
  where oi.region = p_region and cb.category = p_category
    and cb.owner_id is distinct from auth.uid()
    and (cb.organization_id is null or cb.organization_id not in (
          select m.organization_id from public.org_members m where m.user_id = auth.uid()));
$$;

grant execute on function public.get_market_benchmarks(text, text) to authenticated;



-- ============================================================
-- Migration: 20260818130000_dataset_backups.sql
-- ============================================================

-- STEP 4 (Plan Phase 6): per-tenant private parquet backup bucket.
-- Multi-device sync: encrypted-at-rest (Storage SSE) backups uploaded by the
-- owner, RLS-scoped to <owner_id>/<dataset_id>/ prefixes.

insert into storage.buckets (id, name, public)
values ('dataset-backups', 'dataset-backups', false)
on conflict (id) do nothing;

-- Give authenticated users visibility of the bucket itself (needed by the
-- supabase-js storage client).
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'buckets' and policyname = 'authenticated can view backup bucket'
  ) then
    create policy "authenticated can view backup bucket"
      on storage.buckets for select
      to authenticated
      using (id = 'dataset-backups');
  end if;
end $$;

-- Owners upload/list/download only under their own prefix.
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'authenticated can list own backups'
  ) then
    create policy "authenticated can list own backups"
      on storage.objects for select
      to authenticated
      using (
        bucket_id = 'dataset-backups'
        and (storage.foldername(name))[1] = (auth.uid())::text
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'authenticated can upload own backups'
  ) then
    create policy "authenticated can upload own backups"
      on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'dataset-backups'
        and (storage.foldername(name))[1] = (auth.uid())::text
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'authenticated can delete own backups'
  ) then
    create policy "authenticated can delete own backups"
      on storage.objects for delete
      to authenticated
      using (
        bucket_id = 'dataset-backups'
        and (storage.foldername(name))[1] = (auth.uid())::text
      );
  end if;
end $$;



-- ============================================================
-- Migration: 20260819000000_services_catalog.sql
-- ============================================================

-- ============================================================
-- SiroQ Phase 0 â€” consulting services catalogs
--   * purchase / budget / stocktake analysis templates
--   * product template extended with geo + stock-count columns
--
-- Each service line requested by the client maps to a template the
-- pharmacy can submit files against:
--   - supplier analysis  -> purchase template
--   - financial budgets  -> budget template
--   - physical stock count / Ø§Ù„Ø¬Ø±Ø¯ -> stocktake template
--   - geographic analysis -> city/country/region/coordinates roles on
--     sales/purchase files (columns are optional)
--
-- Columns carry role names that mirror lib/analysis/roles.ts (ColumnRole).
-- The DB stores role as free text; the role resolver (_sf_dataset_key_map)
-- reads column_defs.role + the template map, so new roles flow through
-- existing KPI RPCs without changes.
-- ============================================================

insert into public.templates (code, name, description, type, sensitivity)
values
  ('purchase',   'Purchases / supplier', 'Purchase orders and supplier invoices: supplier, PO number, product, qty, cost.', 'product', 'sales_financial'),
  ('budget',     'Financial budget',    'Period targets by category and branch: budget amount vs actual sales.', 'financial', 'sales_financial'),
  ('stocktake',  'Physical stock count', 'Count sheets: product, batch, counted qty vs system stock (Ø§Ù„Ø¬Ø±Ø¯ Ø§Ù„ÙØ¹Ù„ÙŠ).', 'product', 'sales_financial')
on conflict (code) do nothing;

insert into public.template_columns (template_code, key, label, type, required, role) values
  -- Purchases / supplier analysis
  ('purchase', 'purchase_date',  'Purchase date',        'date',    true,  'purchase_date'),
  ('purchase', 'supplier',       'Supplier',             'string',  true,  'supplier'),
  ('purchase', 'purchase_order', 'Purchase order no.',   'string',  false, 'purchase_order'),
  ('purchase', 'branch',         'Branch',               'string',  false, 'branch'),
  ('purchase', 'product',        'Product',              'string',  true,  'product'),
  ('purchase', 'category',       'Category',             'string',  false, 'category'),
  ('purchase', 'purchase_qty',   'Quantity purchased',   'numeric', true,  'purchase_qty'),
  ('purchase', 'purchase_cost',  'Unit purchase cost',   'numeric', false, 'purchase_cost'),
  -- Financial budgets
  ('budget', 'date',        'Period',         'date',    true,  'date'),
  ('budget', 'branch',      'Branch',         'string',  false, 'branch'),
  ('budget', 'category',    'Category',       'string',  false, 'category'),
  ('budget', 'budget',      'Budget amount',  'numeric', true,  'budget'),
  -- Physical stock count / Ø§Ù„Ø¬Ø±Ø¯
  ('stocktake', 'date',        'Count date',      'date',    true,  'date'),
  ('stocktake', 'branch',      'Branch',          'string',  false, 'branch'),
  ('stocktake', 'product',     'Product',         'string',  true,  'product'),
  ('stocktake', 'batch',       'Batch / lot',     'string',  false, 'batch'),
  ('stocktake', 'qty',         'System stock',    'numeric', false, 'qty'),
  ('stocktake', 'counted_qty', 'Counted quantity','numeric', true,  'counted_qty'),
  ('stocktake', 'unit_price',  'Unit price',      'numeric', false, 'unit_price'),
  ('stocktake', 'cost',        'Unit cost',       'numeric', false, 'cost')
on conflict (template_code, key) do nothing;

-- Extend the sales template with optional geographic + sales-force roles
-- (needed for geographic analysis and chain/upstream attribution).
insert into public.template_columns (template_code, key, label, type, required, role) values
  ('sales', 'supplier',     'Supplier',      'string', false, 'supplier'),
  ('sales', 'city',         'City',          'string', false, 'city'),
  ('sales', 'country',      'Country',       'string', false, 'country'),
  ('sales', 'region',       'Region',        'string', false, 'region'),
  ('sales', 'latitude',     'Latitude',      'numeric', false, 'latitude'),
  ('sales', 'longitude',    'Longitude',     'numeric', false, 'longitude'),
  ('sales', 'sales_rep',    'Sales rep',     'string',  false, 'sales_rep'),
  ('sales', 'sales_team',   'Sales team',    'string',  false, 'sales_team')
on conflict (template_code, key) do nothing;


-- ============================================================
-- Migration: 20260819120000_dataset_service_coverage.sql
-- ============================================================

-- ============================================================
-- P2.3 â€” Service coverage + data requests on datasets
--
-- Adds two nullable JSONB columns to `datasets`:
--   * `service_coverage` â€” snapshot of `assessServiceCoverage()` at
--     import time so the operator can review which services the file
--     powers without re-running inference.
--   * `data_requests` â€” the "ask the client for missing data"
--     checklist produced by the coverage card in the upload flow.
--
-- Both columns are NULL by default so existing rows are unaffected.
-- RLS policies already cover `datasets`; no new policies needed.
-- ============================================================

alter table public.datasets
  add column if not exists service_coverage jsonb null,
  add column if not exists data_requests    jsonb null;

comment on column public.datasets.service_coverage is
  'Snapshot of assessServiceCoverage() at import time (array of ServiceCoverage objects).';
comment on column public.datasets.data_requests is
  'Requested missing-role checklist from the upload flow (array of {role, label}).';



-- ============================================================
-- Migration: 20260819130000_training.sql
-- ============================================================

-- ============================================================
-- P5.1 â€” In-app training content (ØªØ¯Ø±ÙŠØ¨)
--
-- Tables:
--   * `training_lessons` â€” one row per lesson (slug, title, body, service)
--   * `training_progress` â€” per-user completion tracking
--
-- Seed: 9 lessons (one per service), Arabic + English titles.
-- RLS: any authenticated user can read lessons; progress is per-user.
-- ============================================================

create table if not exists public.training_lessons (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title_ar    text not null,
  title_en    text not null,
  service_id  text not null,
  body_md     text not null,
  order_index int not null default 0,
  visibility  text not null default 'all' check (visibility in ('all','operator')),
  created_at  timestamptz not null default now()
);

create table if not exists public.training_progress (
  user_id     uuid not null references auth.users(id) on delete cascade,
  lesson_slug text not null references public.training_lessons(slug) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_slug)
);

alter table public.training_lessons enable row level security;
alter table public.training_progress enable row level security;

-- Anyone authenticated can read lessons
create policy "Authenticated read lessons"
  on public.training_lessons for select
  to authenticated
  using (true);

-- Users read/write their own progress
create policy "User read own progress"
  on public.training_progress for select
  to authenticated
  using (auth.uid() = user_id);

create policy "User insert own progress"
  on public.training_progress for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "User delete own progress"
  on public.training_progress for delete
  to authenticated
  using (auth.uid() = user_id);

-- Seed lessons (idempotent)
insert into public.training_lessons (slug, title_ar, title_en, service_id, body_md, order_index) values
  (
    'sales-analysis',
    'ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ø¨ÙŠØ¹',
    'Sales Analysis',
    'sales',
    E'## What is Sales Analysis?\n\nSales analysis tracks revenue, units sold, product mix, and period-over-period performance.\n\n## What data do I need?\n\nAt minimum: **date**, **product**, and **quantity** columns. For deeper insights, add **revenue**, **unit_price**, **category**, and **branch**.\n\n## How to read the output\n\n- **Revenue trend** â€” total revenue over time\n- **Top products** â€” best sellers by units and revenue\n- **Category mix** â€” share of each product category\n\n## Common mistakes\n\n- Missing dates â†’ time-based analysis won\'t work\n- Mixing currencies â†’ ensure all amounts are in the same currency\n- Duplicate rows â†’ use dedup before analysis',
    1
  ),
  (
    'inventory-analysis',
    'ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ù…Ø®Ø²ÙˆÙ†',
    'Inventory Analysis',
    'inventory',
    E'## What is Inventory Analysis?\n\nCovers ABC/XYZ classification, safety stock, expiry risk, and reorder recommendations.\n\n## What data do I need?\n\nAt minimum: **product** and **quantity**. For full coverage: **expiry_date**, **stock_on_hand**, **cost**, **sku**, **batch**.\n\n## How to read the output\n\n- **ABC class** â€” A (top 80% revenue), B (next 15%), C (last 5%)\n- **XYZ class** â€” X (stable demand), Y (variable), Z (erratic)\n- **Safety stock** â€” minimum stock to avoid stockouts\n\n## Common mistakes\n\n- No expiry dates â†’ expiry risk analysis falls back to 180-day assumption\n- Stock snapshots without dates â†’ ABC-XYZ needs historical data',
    2
  ),
  (
    'customer-analysis',
    'ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡',
    'Customer Analysis',
    'customers',
    E'## What is Customer Analysis?\n\nRFM segmentation (Recency, Frequency, Monetary) groups customers by behaviour.\n\n## What data do I need?\n\nAt minimum: **transaction_id** (or invoice number). Better with: **patient/customer ID**, **date**, **revenue**, **qty**.\n\n## How to read the output\n\n- **Segments** â€” Champions, Loyal, At Risk, Lost, Hibernating\n- **RFM scores** â€” 1-5 scale for each dimension\n- **Revenue concentration** â€” top customer share\n\n## Common mistakes\n\n- No transaction ID â†’ individual purchases can\'t be grouped\n- Walk-in customers â†’ use branch + time bucket as fallback',
    3
  ),
  (
    'supplier-analysis',
    'ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ù…ÙˆØ±Ø¯ÙŠÙ†',
    'Supplier Analysis',
    'suppliers',
    E'## What is Supplier Analysis?\n\nTracks spend by supplier, purchase history, price trends, and concentration risk.\n\n## What data do I need?\n\nAt minimum: **supplier** name. Better with: **purchase_date**, **purchase_qty**, **purchase_cost**, **purchase_order**, **product**.\n\n## How to read the output\n\n- **Top suppliers** â€” by total spend\n- **Price trends** â€” cost changes over time\n- **Concentration risk** â€” dependency on single supplier\n\n## Common mistakes\n\n- Mixing purchase and sales data â†’ keep purchases in a separate sheet\n- Missing supplier names â†’ supplier analysis requires a supplier column',
    4
  ),
  (
    'geography-analysis',
    'ØªØ­Ù„ÙŠÙ„ Ø¬ØºØ±Ø§ÙÙŠ',
    'Geographic Analysis',
    'geography',
    E'## What is Geographic Analysis?\n\nShows sales, customers, and stock distribution by city, region, or country on a map.\n\n## What data do I need?\n\nAt minimum: one of **city**, **country**, or **region**. For map plotting: **latitude** and **longitude**.\n\n## How to read the output\n\n- **City/region rankings** â€” top locations by revenue\n- **Map markers** â€” visual distribution when coordinates are provided\n- **Customer density** â€” unique customers per location\n\n## Common mistakes\n\n- No coordinates â†’ table view only (no map)\n- Inconsistent city names â†’ standardize before import',
    5
  ),
  (
    'benchmarking',
    'Ø§Ù„Ù…Ù‚Ø§Ø±Ù†Ø§Øª Ø§Ù„Ù…Ø±Ø¬Ø¹ÙŠØ©',
    'Benchmarks',
    'benchmarks',
    E'## What is Benchmarking?\n\nCompares your pharmacy performance against anonymized market averages from opted-in pharmacies.\n\n## What data do I need?\n\nAt minimum: **date**. Better with: **branch**, **revenue**, **qty**, **category**. You must also **opt in** on the Benchmark tab.\n\n## How to read the output\n\n- **Daily revenue vs market** â€” your performance vs average\n- **Transaction count comparison** â€” foot traffic benchmark\n- **Margin analysis** â€” pricing competitiveness\n\n## Common mistakes\n\n- Not opted in â†’ benchmarking requires explicit opt-in\n- Too few days â†’ need at least 7 days for meaningful comparison',
    6
  ),
  (
    'forecasting',
    'Ø§Ù„ØªÙ†Ø¨Ø¤ Ø¨Ø§Ù„Ù…Ø¨ÙŠØ¹Ø§Øª',
    'Forecasting',
    'forecasting',
    E'## What is Forecasting?\n\nPredicts future demand using moving average and Holt-Winters methods.\n\n## What data do I need?\n\nAt minimum: **date**. Better with: **qty** (for unit forecast) or **revenue** (for revenue forecast), **product**.\n\n## How to read the output\n\n- **Forecast line** â€” predicted values for the next N days\n- **Confidence band** â€” range of likely outcomes\n- **MAPE** â€” prediction accuracy (lower is better)\n\n## Common mistakes\n\n- Too little data â†’ need at least 14 days for reliable forecast\n- Gaps in dates â†’ the model interpolates but accuracy drops',
    7
  ),
  (
    'budgets',
    'Ø§Ù„Ù…ÙˆØ§Ø²Ù†Ø§Øª Ø§Ù„Ù…Ø§Ù„ÙŠØ©',
    'Financial Budgets',
    'budgets',
    E'## What is Budget Analysis?\n\nCompares budgeted targets against actual performance by category and period.\n\n## What data do I need?\n\nA **budget sheet** with period, category, and target amount. For variance analysis, also import a **sales sheet** with actuals.\n\n## How to read the output\n\n- **Attainment %** â€” how much of the budget was achieved\n- **Variance** â€” over/under budget in absolute terms\n- **Burn rate** â€” pace of spending vs plan\n\n## Common mistakes\n\n- Budget and sales in same sheet â†’ separate them into different files\n- Mismatched categories â†’ ensure budget and sales categories align\n- Different time periods â†’ budget periods should match sales periods',
    8
  ),
  (
    'stocktake',
    'Ø§Ù„Ø¬Ø±Ø¯ Ø§Ù„ÙØ¹Ù„ÙŠ',
    'Physical Stock Count',
    'stocktake',
    E'## What is Stock Count Audit?\n\nCompares physical count sheets against system stock to find variances.\n\n## What data do I need?\n\nAt minimum: **product** and **counted_qty**. Better with: **batch**, **unit_price**, **cost**, **date**. System stock comes from the inventory dataset.\n\n## How to read the output\n\n- **Variance lines** â€” products where count differs from system\n- **Total variance** â€” units and value of discrepancies\n- **Audit trail** â€” which products need investigation\n\n## Common mistakes\n\n- No inventory dataset â†’ system stock comparison requires inventory data\n- Counted qty as string â†’ ensure it\'s a number',
    9
  )
on conflict (slug) do update set
  title_ar = excluded.title_ar,
  title_en = excluded.title_en,
  body_md = excluded.body_md,
  order_index = excluded.order_index;



-- ============================================================
-- Migration: 20260819140000_retry_import_idempotent.sql
-- ============================================================

-- ============================================================
-- P6.1 â€” Idempotent retry import
--
-- Adds `import_batch_id` to datasets so each import/retry
-- gets a unique key. The Edge Function can use this to detect
-- duplicate invocations and skip re-processing.
-- ============================================================

-- Add batch ID column (null until first import)
alter table public.datasets
  add column if not exists import_batch_id uuid;

-- Update retry_import RPC to generate a new batch ID on retry
create or replace function public.retry_import(p_dataset_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only superadmins can retry
  if not public.is_superadmin(auth.uid()) then
    raise exception 'Only superadmins can retry imports';
  end if;

  -- Generate a new batch ID for this retry attempt
  update public.datasets
  set
    status = 'pending',
    error_message = null,
    import_batch_id = gen_random_uuid(),
    updated_at = now()
  where id = p_dataset_id;
end;
$$;

-- Add comment for documentation
comment on column public.datasets.import_batch_id is
  'Unique key per import attempt. Edge Function uses this for idempotency.';



-- ============================================================
-- Migration: 20260819140100_snapshot_upsert.sql
-- ============================================================

-- ============================================================
-- P6.2 â€” Upsert instead of delete+insert for snapshot_report_kpis
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



-- ============================================================
-- Migration: 20260819140200_restrict_diag_rpcs.sql
-- ============================================================

-- ============================================================
-- P6.3 â€” Restrict diagnostic RPCs
--
-- Revokes authenticated access from internal diagnostic
-- functions (_diag_roles) and restricts to superadmin only.
-- ============================================================

-- Revoke from authenticated (keep service_role for admin use)
revoke execute on function public._diag_roles() from authenticated;

-- Revoke execute from all other diag functions if they exist
do $$
declare
  r record;
begin
  for r in
    select p.oid::regproc as fn_name
    from pg_proc p
    join pg_namespace n on p.pronamespace = n.oid
    where n.nspname = 'public'
      and p.proname like '_diag_%'
  loop
    execute format('revoke execute on function %s from authenticated', r.fn_name);
  end loop;
end $$;

-- Add comment documenting the restriction
comment on function public._diag_roles() is
  'Internal diagnostic â€” restricted to service_role (superadmin) only.';



