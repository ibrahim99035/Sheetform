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
