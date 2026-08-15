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
--     superadmins must unlink references first — mirror of BRANCH_IN_USE).
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