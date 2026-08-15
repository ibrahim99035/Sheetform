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
