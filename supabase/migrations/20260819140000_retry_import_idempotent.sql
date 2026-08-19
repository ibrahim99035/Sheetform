-- ============================================================
-- P6.1 — Idempotent retry import
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
