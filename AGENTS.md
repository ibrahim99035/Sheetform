<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:coordination -->

# Coordination (read at session start, mandatory)

This repo is worked on by multiple agents/humans from different devices. The shared prime of truth is committed, not local.

1. **Before doing anything, read both:**
   - `docs/PLAN-REMAINING.md` — the master plan (what the remaining work is, file-level tasks, acceptance criteria).
   - `docs/STATUS.md` — the live task ledger (what is done/active/blocked, who owns what).
2. **One task at a time.** Before starting a task, flip its STATUS.md row to `active` and write your handle in **Owner** (same commit or the commit right before the work).
3. **Every change targets a task id.** Commit messages are prefixed `P<phase>.<task>` (e.g. `P2.2: coverage card in upload flow`). This makes `git log` a per-task audit trail.
4. **STATUS.md is updated in the same commit** that completes the work — `done` only when the row's Verification actually passes (tests green, `tsc --noEmit` clean, `eslint` 0 errors).
5. **Never claim done on tests you didn't run.** If a verification can't run in your environment, leave the row `active` and add a note in **Open questions / handoffs**.
6. **Nothing else lives outside the repo.** Project memory (memory MCP), review decisions and cross-agent messages all get a one-line reference in `docs/STATUS.md` or the commit message so a fresh session can rebuild context.

<!-- END:coordination -->
