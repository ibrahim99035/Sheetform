# Sheetform

A CSV / Excel analytics platform built with **Next.js 16** and **Supabase**.
Upload a spreadsheet, preview and edit it in a fast virtualized table, apply
transforms with full undo/redo, explore grouped analytics, and export the
result — all with a polished light/dark UI that works down to 320px screens.

Live at **[https://sheetform-eight.vercel.app/](https://sheetform-eight.vercel.app/)**.

## Features

- **Upload & import** — drag-and-drop CSV / XLSX / XLS; automatic column-type detection; background import via Supabase DB webhook → Edge Function with live status.
- **Virtualized data table** — windowed infinite scroll, sortable/filterable columns, sticky header + sticky `#` column, inline cell editing (double-click or tap).
- **Transforms + undo/redo** — rename columns, filter rows, remove duplicates, edit cells — every operation reversible, with per-operation audit.
- **Analyze** — per-column stats (min/max/avg/sum/distinct/empty) and a group-by aggregation builder with charts and result tables.
- **Exports** — CSV or XLSX of the current filtered/sorted view, or the original file.
- **Auth & roles** — email/password accounts, per-user private data via Row Level Security, and a **superadmin** role that can view/edit any user's files from an admin panel.
- **Dark mode** — no-flash theme, theme-aware inputs (autofill/caret colors), accessible toasts.
- **Mobile-first** — 44px touch targets, tap-to-edit, safe-area handling, responsive shell/filters/charts.

## Tech stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **UI:** React 19, Tailwind CSS v4, lucide-react, Recharts, TanStack Query + Virtual
- **Backend:** Supabase (Postgres, Auth, Storage, Realtime, Edge Functions)
- **Files:** xlsx, papaparse
- **Deploy:** Vercel

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Configuration

Copy `.env.example` to `.env.local` and fill in your Supabase project keys:

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon (client) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server scripts only) |
| `NEXT_PUBLIC_SITE_URL` | Base URL (`http://localhost:3000` locally) |

### Setting up the database

```bash
node scripts/push-migrations.mjs        # applies pending migrations, tracks applied ones
node scripts/create-webhook.mjs         # DB webhook → import-dataset Edge Function
```

This requires a Supabase access token (via `npx supabase login` or
`SUPABASE_ACCESS_TOKEN`). See `docs/SPECS.md` for the full schema and RPCs.

### Superadmin

```bash
node scripts/add-admin.mjs user@example.com      # elevate
node scripts/add-admin.mjs user@example.com --remove
```

An admin sees an **Admin** link in the app shell, can list all users and their
files, and open/edit/export any dataset (actions are audited with the admin's
user id). Elevation requires the service-role key — regular users can never
self-grant.

## Scripts

| Script | Purpose |
| --- | --- |
| `scripts/push-migrations.mjs` | Apply pending SQL migrations idempotently |
| `scripts/add-admin.mjs` | Grant/revoke superadmin |
| `scripts/create-webhook.mjs` | Wire the import DB webhook |
| `scripts/e2e-smoke.mjs` / `e2e-cleanup.mjs` | Import-pipeline smoke test / cleanup |

## Development

```bash
npm run lint    # eslint
npm run build   # production build (+ typecheck)
```

## Documentation

- **`docs/SPECS.md`** — detailed product specs: architecture, schema, security/RLS model, DB functions, migrations, environment, testing, roadmap.

## License

Private project.