-- ============================================================
-- P6.3 — Restrict diagnostic RPCs
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
  'Internal diagnostic — restricted to service_role (superadmin) only.';
