-- ============================================================
-- Phase 5 — Benchmarking uplink (opt-in, aggregates only)
--
-- The control plane only ever receives pre-computed daily/category
-- aggregates (kilobytes). Raw rows and patient identifiers NEVER leave
-- the client (lib/privacy.ts / lib/benchmark-sync.ts).
--
-- Tenant is polymorphic so BOTH org-scoped datasets (organization_id)
-- and operator/superadmin uploads (owner_id) can participate:
--   exactly one of organization_id / owner_id is set per row (CHECK).
-- RLS: org rows are scoped to org members (write: owners/managers);
--       owner rows are scoped to that auth user.
-- ============================================================

-- ---------- Org-level region metadata (market filtering source) ----------

alter table public.org_profile
  add column region text;

-- ---------- Daily aggregates ----------

create table public.daily_aggregates (
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  day date not null,
  branch text not null default '',           -- dataset branch label ('' = none)
  total_revenue numeric not null default 0,
  transaction_count integer not null default 0,
  units numeric not null default 0,
  distinct_products integer not null default 0,
  computed_at timestamptz not null default now(),
  constraint daily_aggregates_one_tenant check ((organization_id is null) <> (owner_id is null))
);

create unique index uq_daily_org on public.daily_aggregates (organization_id, day, branch)
  where organization_id is not null;
create unique index uq_daily_owner on public.daily_aggregates (owner_id, day, branch)
  where owner_id is not null;
create index idx_daily_aggregates_day on public.daily_aggregates(day);
create index idx_daily_aggregates_region_lookup on public.daily_aggregates(organization_id, day);

-- ---------- Monthly category benchmarks ----------

create table public.category_benchmarks (
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  month date not null,                       -- first day of month
  category text not null,
  avg_margin numeric,                        -- NULL when no cost column in source
  revenue numeric not null default 0,
  units numeric not null default 0,
  share_pct numeric,
  computed_at timestamptz not null default now(),
  constraint category_benchmarks_one_tenant check ((organization_id is null) <> (owner_id is null))
);

create unique index uq_cat_org on public.category_benchmarks (organization_id, month, category)
  where organization_id is not null;
create unique index uq_cat_owner on public.category_benchmarks (owner_id, month, category)
  where owner_id is not null;
create index idx_category_benchmarks_month on public.category_benchmarks(month);

-- ---------- Opt-in gate (default OFF, mirrors lib/types.ts BenchmarkOptIn) ----------

create table public.benchmark_opt_in (
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  region text,                               -- overrides org_profile.region when set
  opted_in_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint benchmark_opt_in_one_tenant check ((organization_id is null) <> (owner_id is null))
);

create unique index uq_optin_org on public.benchmark_opt_in (organization_id)
  where organization_id is not null;
create unique index uq_optin_owner on public.benchmark_opt_in (owner_id)
  where owner_id is not null;

-- ---------- Grants ----------

grant select, insert, update, delete on public.daily_aggregates to authenticated, service_role;
grant select, insert, update, delete on public.category_benchmarks to authenticated, service_role;
grant select, insert, update, delete on public.benchmark_opt_in to authenticated, service_role;

-- ---------- Row Level Security ----------

alter table public.daily_aggregates enable row level security;
alter table public.category_benchmarks enable row level security;
alter table public.benchmark_opt_in enable row level security;

create policy "org members read daily aggregates" on public.daily_aggregates
  for select using (
    public._sf_is_org_member(organization_id) or public.is_superadmin()
  );
create policy "org managers write daily aggregates" on public.daily_aggregates
  for all using (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  )
  with check (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  );
create policy "owner reads own daily aggregates" on public.daily_aggregates
  for select using (owner_id = auth.uid() or public.is_superadmin());
create policy "owner writes own daily aggregates" on public.daily_aggregates
  for all using (owner_id = auth.uid() or public.is_superadmin())
  with check (owner_id = auth.uid() or public.is_superadmin());

create policy "org members read category benchmarks" on public.category_benchmarks
  for select using (
    public._sf_is_org_member(organization_id) or public.is_superadmin()
  );
create policy "org managers write category benchmarks" on public.category_benchmarks
  for all using (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  )
  with check (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  );
create policy "owner reads own category benchmarks" on public.category_benchmarks
  for select using (owner_id = auth.uid() or public.is_superadmin());
create policy "owner writes own category benchmarks" on public.category_benchmarks
  for all using (owner_id = auth.uid() or public.is_superadmin())
  with check (owner_id = auth.uid() or public.is_superadmin());

create policy "org members read opt-in" on public.benchmark_opt_in
  for select using (
    public._sf_is_org_member(organization_id) or public.is_superadmin()
  );
create policy "org managers write opt-in" on public.benchmark_opt_in
  for all using (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  )
  with check (
    public._sf_is_org_manager(organization_id) or public.is_superadmin()
  );
create policy "owner reads own opt-in" on public.benchmark_opt_in
  for select using (owner_id = auth.uid() or public.is_superadmin());
create policy "owner writes own opt-in" on public.benchmark_opt_in
  for all using (owner_id = auth.uid() or public.is_superadmin())
  with check (owner_id = auth.uid() or public.is_superadmin());

-- ---------- Upsert RPC (validates caller, then stores KB payload) ----------

create or replace function public.upsert_benchmark_aggregates(
  p_payload jsonb,
  p_org_id uuid default null,
  p_owner_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date;
  d record;
  c record;
begin
  -- Authorize: exactly one tenant axis, matching the caller.
  if (p_org_id is not null) = (p_owner_id is not null) then
    raise exception 'FORBIDDEN';
  end if;
  if p_org_id is not null and not (public._sf_is_org_manager(p_org_id) or public.is_superadmin()) then
    raise exception 'FORBIDDEN';
  end if;
  if p_owner_id is not null and not (auth.uid() = p_owner_id or public.is_superadmin()) then
    raise exception 'FORBIDDEN';
  end if;

  -- Daily aggregates.
  if p_owner_id is not null then
    for d in
      select * from jsonb_to_recordset(coalesce(p_payload -> 'days', '[]'::jsonb)) as t(
        day date, branch text, revenue numeric, transactions integer,
        units numeric, distinct_products integer)
    loop
      insert into public.daily_aggregates
        (organization_id, owner_id, day, branch, total_revenue, transaction_count, units, distinct_products)
      values (null, p_owner_id, d.day, coalesce(d.branch, ''), coalesce(d.revenue, 0),
              coalesce(d.transactions, 0), coalesce(d.units, 0), coalesce(d.distinct_products, 0))
      on conflict (owner_id, day, branch) where owner_id is not null do update set
        total_revenue = excluded.total_revenue,
        transaction_count = excluded.transaction_count,
        units = excluded.units,
        distinct_products = excluded.distinct_products,
        computed_at = now();
    end loop;
  else
    for d in
      select * from jsonb_to_recordset(coalesce(p_payload -> 'days', '[]'::jsonb)) as t(
        day date, branch text, revenue numeric, transactions integer,
        units numeric, distinct_products integer)
    loop
      insert into public.daily_aggregates
        (organization_id, owner_id, day, branch, total_revenue, transaction_count, units, distinct_products)
      values (p_org_id, null, d.day, coalesce(d.branch, ''), coalesce(d.revenue, 0),
              coalesce(d.transactions, 0), coalesce(d.units, 0), coalesce(d.distinct_products, 0))
      on conflict (organization_id, day, branch) where organization_id is not null do update set
        total_revenue = excluded.total_revenue,
        transaction_count = excluded.transaction_count,
        units = excluded.units,
        distinct_products = excluded.distinct_products,
        computed_at = now();
    end loop;
  end if;

  -- Monthly category benchmarks.
  v_month := date_trunc('month', (p_payload ->> 'computed_at')::timestamptz)::date;
  if p_owner_id is not null then
    for c in
      select * from jsonb_to_recordset(coalesce(p_payload -> 'categories', '[]'::jsonb)) as t(
        category text, revenue numeric, units numeric, share_pct numeric, margin_pct numeric)
    loop
      insert into public.category_benchmarks
        (organization_id, owner_id, month, category, avg_margin, revenue, units, share_pct)
      values (null, p_owner_id, v_month, c.category, c.margin_pct, coalesce(c.revenue, 0),
              coalesce(c.units, 0), c.share_pct)
      on conflict (owner_id, month, category) where owner_id is not null do update set
        avg_margin = excluded.avg_margin,
        revenue = excluded.revenue,
        units = excluded.units,
        share_pct = excluded.share_pct,
        computed_at = now();
    end loop;
  else
    for c in
      select * from jsonb_to_recordset(coalesce(p_payload -> 'categories', '[]'::jsonb)) as t(
        category text, revenue numeric, units numeric, share_pct numeric, margin_pct numeric)
    loop
      insert into public.category_benchmarks
        (organization_id, owner_id, month, category, avg_margin, revenue, units, share_pct)
      values (p_org_id, null, v_month, c.category, c.margin_pct, coalesce(c.revenue, 0),
              coalesce(c.units, 0), c.share_pct)
      on conflict (organization_id, month, category) where organization_id is not null do update set
        avg_margin = excluded.avg_margin,
        revenue = excluded.revenue,
        units = excluded.units,
        share_pct = excluded.share_pct,
        computed_at = now();
    end loop;
  end if;
end $$;

grant execute on function public.upsert_benchmark_aggregates(jsonb, uuid, uuid) to authenticated;

-- ---------- Opt-in RPC (single row per tenant, owner/manager-guarded) ----------

create or replace function public.set_benchmark_opt_in(
  p_enabled boolean,
  p_region text default null,
  p_org_id uuid default null,
  p_owner_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (p_org_id is not null) = (p_owner_id is not null) then
    raise exception 'FORBIDDEN';
  end if;
  if p_org_id is not null and not (public._sf_is_org_manager(p_org_id) or public.is_superadmin()) then
    raise exception 'FORBIDDEN';
  end if;
  if p_owner_id is not null and not (auth.uid() = p_owner_id or public.is_superadmin()) then
    raise exception 'FORBIDDEN';
  end if;

  if p_org_id is not null then
    insert into public.benchmark_opt_in (organization_id, enabled, region, opted_in_at, updated_at)
    values (p_org_id, p_enabled, nullif(btrim(coalesce(p_region, '')), ''), case when p_enabled then now() end, now())
    on conflict (organization_id) where organization_id is not null do update set
      enabled = excluded.enabled,
      region = excluded.region,
      opted_in_at = case when excluded.enabled then coalesce(benchmark_opt_in.opted_in_at, now()) else null end,
      updated_at = now();
  else
    insert into public.benchmark_opt_in (owner_id, enabled, region, opted_in_at, updated_at)
    values (p_owner_id, p_enabled, nullif(btrim(coalesce(p_region, '')), ''), case when p_enabled then now() end, now())
    on conflict (owner_id) where owner_id is not null do update set
      enabled = excluded.enabled,
      region = excluded.region,
      opted_in_at = case when excluded.enabled then coalesce(benchmark_opt_in.opted_in_at, now()) else null end,
      updated_at = now();
  end if;
end $$;

grant execute on function public.set_benchmark_opt_in(boolean, text, uuid, uuid) to authenticated;

-- ---------- Market benchmark RPC: AVERAGES ONLY, caller excluded ----------
-- Returns market aggregates across every other opted-in tenant in the region,
-- never raw rows and never per-tenant figures.

create or replace function public.get_market_benchmarks(p_region text, p_category text)
returns table (metric text, market_value numeric, sample_orgs bigint)
language sql
stable
security definer
set search_path = public
as $$
  select 'avg_daily_revenue', avg(da.total_revenue), count(distinct da.organization_id) + count(distinct da.owner_id)
  from public.daily_aggregates da
  join public.benchmark_opt_in oi on oi.enabled
    and (oi.organization_id = da.organization_id or oi.owner_id = da.owner_id)
  where oi.region = p_region
    and da.owner_id is distinct from auth.uid()
    and (da.organization_id is null or da.organization_id not in (
          select m.organization_id from public.org_members m where m.user_id = auth.uid()))
  union all
  select 'avg_daily_transactions', avg(da.transaction_count), count(distinct da.organization_id) + count(distinct da.owner_id)
  from public.daily_aggregates da
  join public.benchmark_opt_in oi on oi.enabled
    and (oi.organization_id = da.organization_id or oi.owner_id = da.owner_id)
  where oi.region = p_region
    and da.owner_id is distinct from auth.uid()
    and (da.organization_id is null or da.organization_id not in (
          select m.organization_id from public.org_members m where m.user_id = auth.uid()))
  union all
  select 'avg_category_margin', avg(cb.avg_margin), count(distinct cb.organization_id) + count(distinct cb.owner_id)
  from public.category_benchmarks cb
  join public.benchmark_opt_in oi on oi.enabled
    and (oi.organization_id = cb.organization_id or oi.owner_id = cb.owner_id)
  where oi.region = p_region and cb.category = p_category
    and cb.owner_id is distinct from auth.uid()
    and (cb.organization_id is null or cb.organization_id not in (
          select m.organization_id from public.org_members m where m.user_id = auth.uid()));
$$;

grant execute on function public.get_market_benchmarks(text, text) to authenticated;
