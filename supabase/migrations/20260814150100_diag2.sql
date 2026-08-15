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
