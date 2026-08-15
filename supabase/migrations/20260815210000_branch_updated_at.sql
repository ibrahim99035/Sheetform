-- ============================================================
-- SiroQ Phase 2 fix — branches.updated_at
-- submit_branch_profile / approve_pharmacy / reject_pharmacy set
-- updated_at on branches, but the Phase 1 branches table predates
-- org status lifecycle and has no updated_at column.
-- ============================================================

alter table public.branches
  add column updated_at timestamptz not null default now();