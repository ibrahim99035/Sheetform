-- STEP 4 (Plan Phase 6): per-tenant private parquet backup bucket.
-- Multi-device sync: encrypted-at-rest (Storage SSE) backups uploaded by the
-- owner, RLS-scoped to <owner_id>/<dataset_id>/ prefixes.

insert into storage.buckets (id, name, public)
values ('dataset-backups', 'dataset-backups', false)
on conflict (id) do nothing;

-- Give authenticated users visibility of the bucket itself (needed by the
-- supabase-js storage client).
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'buckets' and policyname = 'authenticated can view backup bucket'
  ) then
    create policy "authenticated can view backup bucket"
      on storage.buckets for select
      to authenticated
      using (id = 'dataset-backups');
  end if;
end $$;

-- Owners upload/list/download only under their own prefix.
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'authenticated can list own backups'
  ) then
    create policy "authenticated can list own backups"
      on storage.objects for select
      to authenticated
      using (
        bucket_id = 'dataset-backups'
        and (storage.foldername(name))[1] = (auth.uid())::text
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'authenticated can upload own backups'
  ) then
    create policy "authenticated can upload own backups"
      on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'dataset-backups'
        and (storage.foldername(name))[1] = (auth.uid())::text
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'authenticated can delete own backups'
  ) then
    create policy "authenticated can delete own backups"
      on storage.objects for delete
      to authenticated
      using (
        bucket_id = 'dataset-backups'
        and (storage.foldername(name))[1] = (auth.uid())::text
      );
  end if;
end $$;
