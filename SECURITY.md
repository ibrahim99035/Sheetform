# SiroQ — Security Policy

Scope: the SiroQ platform (Next.js app + Supabase backend, Edge Functions, storage).

## Reporting & contact

- **Do not** open a public issue for anything that looks like a live vulnerability.
- Report security issues privately to the maintainers (issue tracker / ops contact listed
  in `docs/OPS.md`). Include a repro or proof-of-concept, affected versions, and impact.

## Trust model

- Tenancy: **an organization (association) is the tenancy boundary**; a branch (pharmacy)
  is a unit within it. Data is scoped by organization.
- Actors: **superadmin** (central operator), **owner** (association admin), **pharmacist**
  (branch-scoped member), **unauthenticated (anon)**.
- The central operator is a single trusted party — superadmin privileges are a deliberate
  design choice, not a security gap.

## Data access control

- **RLS everywhere.** Public tables default to row-level security; read policies are
  organization/branch-aware via `org_members` (role + `branch_scope`). Service-role is
  restricted to trusted clients/Edge Functions.
- **Writes go through SECURITY DEFINER RPCs** that self-guard (`is_superadmin()`,
  membership checks) and raise `FORBIDDEN` otherwise. Rule of thumb: no direct
  authenticated INSERT/UPDATE/DELETE on sensitive tables — use RPCs.
- Functions pin `set search_path = public`; body `quote_literal`s all dynamic values;
  no dynamic SQL execution paths.
- Filesystem: `updates`/`uploads` buckets are private, keyed by `user_id/…` prefixes so a
  user can only address their own paths.

## Data protection

- Classification: every template declares `sensitivity` (`none` / `sales_financial` /
  `patient_health`); datasets inherit it for retention enforcement.
- Retention: `public.retention_policies` controls windows (defaults 3y / 6y). Enforcement
  via `purge_expired` (cron weekly) + `archive_dataset`/`purge_dataset`. `audit_log` is
  append-only and never purged.
- Data-subject requests: `request_subject_action` (export/delete) → operator resolves
  via `process_subject_request`; exports land in `subject_requests.payload` (role-scoped).
- At rest/in transit: Supabase-managed TLS in transit; production enables daily backups +
  PITR (see `docs/OPS.md`).

## Authentication & session

- Supabase Auth (email/password). Use confirmed email + strong-password policy.
- The delivery worker validates `WEBHOOK_SECRET`; Edge Functions trust the service role
  via project secrets (never client keys).

## Incident response

1. Contain: revoke the affected token/secret via the Supabase dashboard,
   suspend the user, or rotate the affected credential.
2. Triage via `public.audit_log` (append-only) + Supabase/Vercel/Sentry logs.
3. Fix forward: migration + code hotfix; never DROP data as a rollback path.
4. Post-mortem entry in `docs/OPS.md::Incidents`.

## Known limitations (transparency)

- WhatsApp delivery is a Meta Cloud API adapter (stub provider); provider tokens are
  project secrets.
- Superadmin identity is a single user; multi-operaator admin administration
  (`admin_users`) is not yet multi-role.

_Reviewed on every migration adding security-relevant functions (Phase plan: P5 compliance,
P6 scale)._