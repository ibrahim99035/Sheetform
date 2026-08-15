-- ============================================================
-- SiroQ Phase 4 fix — queue_report_deliveries boolean decl
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