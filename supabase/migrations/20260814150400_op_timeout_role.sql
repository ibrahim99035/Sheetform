-- ============================================================
-- SiroQ mutation-ops timeout: role-level statement_timeout
--
-- A prior attempt (20260814140000_op_timeout.sql) set
-- statement_timeout inside the RPC bodies via set_config. That
-- cannot work: PostgREST runs each RPC as a single SELECT, and
-- Postgres snapshots statement_timeout at statement start, so
-- changing it mid-statement has no effect (observed: a 10s
-- pg_sleep after set_config is still cancelled at the ~8s
-- default). The timeout must be raised where it is in effect
-- before any statement begins: at the role.
--
-- Rename/undo/redo rewrite the dataset_rows JSONB table plus
-- recompute column stats; on the hosted instance that reliably
-- exceeds the ~8s default for datasets in the tens of thousands
-- of rows (health_indicators_egy: 25,585). Authenticated callers
-- (the operator UI) get 2 minutes; reads and light RPCs are
-- unaffected in practice. service_role keeps a sane default too
-- so import webhooks do not block the pool.
--
-- ALTER ROLE applies to sessions started after the change; the
-- pooler opens fresh connections for new requests, so the new
-- value takes effect immediately for client traffic.
-- ============================================================

alter role authenticated set statement_timeout = '2min';
alter role service_role set statement_timeout = '2min';
