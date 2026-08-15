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