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
               from (select unnest(array[''€'',''$'',''£'',''₺'',''ر.س'','' د.م'']) as sym) s
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
