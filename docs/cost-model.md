# SiroQ — Cost model & vendor analysis

> Internal working document. This is planning material — it prices the running
> service, not any one engagement. Currency: **EGP** for pharmacy-facing figures;
> vendors bill in **USD**. Rates below are list prices pulled fresh (2026), using
> a mid-market **≈ 50.3 EGP/USD** (Central Bank of Egypt, Aug 2026); re-check at
> renewal time — every vendor changes prices at least once a year.

Assumptions for the three scenarios:

| Scenario | Pharmacies | Reports / mo |
| --- | --- | --- |
| Small | 10 | 10 |
| Medium | 100 | 100 |
| Large | 500 | 500 |

Each report is delivered **two ways equally**: one email + one WhatsApp message
per pharmacy per month. Only 3 revenue-block types have real model-driven
numbers today (see Engine section) — all estimates below are derived from that.

---

## 1. Hosting & platform

### Vercel (Next.js app)

| Tier | Price | Limits |
| --- | --- | --- |
| Hobby | $0 | OK for evaluation/dev. **Non-commercial** terms — not appropriate once revenue flows. 100 GB bandwidth/mo, 90-day log retention, no output cache control. |
| Pro | **$20 / user / mo** | 1 TB bandwidth, 200 GB image optimization, premium support. Charged per seat, so keep the ops team small (1 seat). |

Pick: **Pro, 1 seat** once in production → **$20/mo (≈ 1,010 EGP)**.
Spikes: bandwidth is inclusive at our volume (report pages are mostly small
static-ish JSON + shared CSS; a 500-pharmacy month is nowhere near 1 TB).

### Supabase (Postgres + Auth + Storage + Edge Functions + pg_cron)

Holds the hosted project `vhgkjxdwptirmyqjhiks` (ref to be reconfirmed). Current
secrets on it: only Supabase-native keys + `WEBHOOK_SECRET` — see provisioning.

| Tier | Price | Key limits |
| --- | --- | --- |
| Free | $0 | 500 MB Postgres, 5 GB Egress/mo, **pause after 1 week inactivity** (kills webhook/live behavior), 2 active projects, no custom domain on Auth. |
| **Pro** | **$25 / org / mo** | 8 GB disk → scales to 256 GB (+$), **250 GB egress/mo**, 100 GB storage, **includes $10 compute credit → 1 free micro instance** (2 vCPU, 1 GB). Additional micro = $10/mo. Pausing configurable. Teams/SAML etc. |
| Team | $599 / mo | SOC 2, ISO 27001, HIPAA add-on, 7-day PITR. Not needed unless compliance is a must. |

Compute note: one micro instance is included on Pro via the $10 credit, so a
single-project setup is effectively **$25/mo**. Running a separate staging
project on the same org = +$10 instance/mo (or stay on Free for staging).

Pick: **Pro** (production must not pause; retention pg_cron jobs run there).
Base: **$25/mo** org fee. Two projects (prod + staging) ≈ **$35/mo**.

---

## 2. Delivery: email

Provider = **Resend** (adapter wired in `deliver-reports`; REST API). Postal
DNS records required on the sending domain.

| Tier | Price | Limits |
| --- | --- | --- |
| Free | $0 | 3,000 emails/mo, **100/day**, 1 custom domain |
| Pro | **$20/mo** | 50,000/mo, 5 MB attachments, 7-day logs, overage ~$0.0008/email; annual ≈ −20% |
| Scale | $90/mo | 100,000/mo |

Our volume: 10–500 emails/mo → **Free tier covers everything** ($0). Escalation
path: >100/day or >3,000/mo → Pro $20/mo.

Free consumer SMTP (Gmail/Outlook) is a **non-option**: bulk-send ToS bans,
landing in spam, no delivery logging, daily caps, and no sending identity.
Cost of building an internal mail server ourselves ≫ Resend.

---

## 3. Delivery: WhatsApp (Meta Cloud API, Egypt)

Meta bills **per delivered template message, by the recipient's country**
(country-based rates; conversation-based billing retired). Service/user-initiated
replies = still free. No charge until the message is actually delivered.

**Egypt rates (Meta country card, 2026):**

| Template category | ~$ per message delivered to EG |
| --- | --- |
| Utility | **~$0.0036** |
| Marketing | **~$0.0644** |
| Auth | like Utility |
| Service (user-initiated) | **$0** |

Monthly forecast (both the "report" template — utility class — and any marketing
header):

| Pharmacies | Utility | Marketing |
| --- | --- | --- |
| 10 | $0.04 | $0.64 |
| 100 | $0.36 | $6.44 |
| 500 | **$1.80** | **$32.20** |

Real costs to call out:

- **Onboarding** is the unavoidable spend: Meta Business verification + WhatsApp
  Business Account (WABA) + a phone number + **template approval** (business-initiated
  messages must pre-approve via approved templates). Doing it via a **BSP** adds
  ~$29–$100+/mo platform fee (varies); going **direct to Graph API** avoids the
  monthly fee but we do verification ourselves. (Direction for this is still open;
  neither is baked into forecasts above.)
- A "open the report" action needs an approved template with a **URL button** +
  delivery webhook — our current `sendWhatsApp` sends plain-text templates only.

Bottom line: delivery cost is dominated by **which template category** (utility 0.4%
of revenue-scale vs marketing ~18× more per message), not by volume at our size.

---

## 4. Analysis engine — deterministic today, AI optional

Palpable truth: **no AI vendor is called anywhere in code.** The whole engine
(role classification, metrics, insights, tables, charts) is deterministic
heuristics + SQL — repeatable, auditable, offline. Only vestige: an unused
`openai_api_key = env(OPENAI_API_KEY)` in `supabase/config.toml:101` (Vector /
embedding config), never referenced from code and no key set.

So AI is a **future/optional line**, priced as levers. If/when we add an LLM
(narrative writing, summarization of findings, Q&A) it should be **vendor-agnostic
by design** so cost + quality can be traded per patient/privacy needs. 2026 list
prices, per 1M tokens (input / output):

| Vendor | Model | Input / 1M | Output / 1M | Notes |
| --- | --- | --- | --- | --- |
| OpenAI | GPT-4o mini (legacy) | $0.15 | $0.60 | Old pricing, pre-Sept-2025 buckets |
| OpenAI | GPT-5.4 mini | $0.75 | $4.50 | Current-gen; web-search tool adds a fixed 8k-token input block per call |
| Google | Gemini 2.5 Flash | $0.15 | $0.60 | Free tier ~20 RPM exists |
| Google | Gemini 2.5 Pro | $0.63 | $5.00 | Range quoted $1.25–$10/1M in some sources |
| DeepSeek | V4 Pro | $0.43 | $0.87 | 1M context; cached input $0.004/1M |
| Mistral | Large | $2.00 | $6.00 | Batch −50% |
| Anthropic | Claude Sonnet 4.6 / Sonnet 5 (Feb & Jun 2026) | — | — | Exact per-token rates not captured; on Claude Platform / Vertex / AWS / Azure |

Workload estimate for a monthly report narrative: ≈ 5k input (schema + KPIs +
context) + ≈ 1k output tokens → ~10 m, so even at the most expensive listed rate
the per-report AI cost rounds to **fractions of a cent**. The line only matters
once we ship AI features; it is **zero today**.

---

## 5. Observability — deliberately minimal

No Sentry in the cost plan (though `@sentry/nextjs@^10.70.0` is installed). We get
alerts + retention from what we already pay for:

- Vercel server logs (Pro includes 7-day) — `lib/log.ts` structured JSON.
- Supabase Edge Logs — correlates by `datasetId` for `import-dataset` /
  `deliver-reports`.
- Supabase monitoring alerts (CPU, egress, error rate) via dashboard/email.
- `public.audit_log` (append-only) doubles as the compliance audit trail.

If we ever add real tracing/error UX, a later decision — **not** assumed here.

---

## 6. Monthly P&L by scenario

All figures USD, list price, both channels (email WhatsApp) on every report.

| Line | 10 ph | 100 ph | 500 ph |
| --- | --- | --- | --- |
| Vercel Pro (1 seat) | $20.00 | $20.00 | $20.00 |
| Supabase Pro (+staging micro) | $35.00 | $35.00 | $35.00 |
| Resend email (Free tier) | $0.00 | $0.00 | $0.00 |
| WhatsApp utility (Egypt) | $0.04 | $0.36 | $1.80 |
| WhatsApp marketing (Egypt) | $0.64 | $6.44 | $32.20 |
| AI (none today) | $0.00 | $0.00 | $0.00 |
| Sentry | — | — | — |
| **Fixed + delivery total (USD)** | **$55–56** | **$55–62** | **$57–89** |
| **≈ Total (EGP @ 50.3)** | **≈ 2,770–2,820** | **≈ 2,770–3,120** | **≈ 2,870–4,480** |

The step between scenarios is roughly one order of magnitude smaller than the
fixed platform bill — **volume scales nearly free** until the first Resend tier /
Meta rate-class jump. On top of the widget bill, budget **~$200–400 (≈
10,000–20,000 EGP) one-off** for Meta WhatsApp onboarding (business verification,
WABA, template approval; a BSP would add a monthly platform fee instead).

---

## 7. Known provisioning & correctness gaps (cost-relevant)

1. **No provider secrets on hosted.** Resend + WhatsApp are adapters only —
   without `RESEND_API_KEY` / `RESEND_FROM` / `WHATSAPP_TOKEN` /
   `WHATSAPP_PHONE_ID`, rows end `failed` with `NO_*_PROVIDER`. `deliveries` is at
   **0 rows** on hosted. 5-min ops step: `npx supabase secrets set … ` then
   `npx supabase functions deploy deliver-reports` (see `deliver-reports` header +
   `docs/OPS.md`).
2. **AMD typo.** `deliver-reports/index.ts:77` hard-codes `Gross margin (AMD)`.
   Must become EGP with the currency fix. The analysis formatters also hard-code
   `USD` (`lib/analysis/markdown.ts`, `lib/analysis/insights.ts`) while the engine's
   currency detection is a heuristic on column symbols.
3. **WhatsApp "open report" flow.** Not implemented — needs approved URL-button
   template + webhook to mark read/claimed. Text-only template today.
4. **DRY_RUN=1 default** in `scripts/deliver-reports.mjs` — production path must
   unset it explicitly.
5. **No currency conversion is modeled** — engine shows raw figures with a symbol
   label only; we do not convert to EGP programmatically yet.

---

## 8. Pricing levers (what actually moves the bill)

- **WhatsApp template category** is the single biggest lever (utility vs marketing
  ≈ ×18 in Egypt). Use utility-class for the routine report; reserve marketing
  for opt-in promos.
- **BSP vs direct Graph API** decides whether onboarding is a one-off + per-$ fee
  or a monthly platform fee (~$29–$100/mo typical). Open decision.
- **Supabase staging on Free** vs +$10 micro — keep staging on Free until needed.
- **Vercel seats** — keep at 1.
- **AI features are additive** — ship a multi-vendor abstraction if/when we do;
  today they cost $0.