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
