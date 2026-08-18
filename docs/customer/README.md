# SiroQ — customer-facing package

Materials for the customer conversation (non-technical). All files are plain
and jargon-free.

> **Framing:** the customer is the **operator / association** who demands the
> SaaS and runs a data-advisory service for their **client pharmacies** — the
> pharmacists are the end beneficiaries, not the buyer. Everything below speaks
> to the buyer: "here is a system you operate to serve your pharmacies at scale."

## Files

| File | What it is |
| --- | --- |
| `01-overview.drawio` | Diagram — **SiroQ at a glance**: your pharmacies → you (operator) → back to your pharmacies. |
| `01-overview.md` | Explanation — what the buyer gets and who is on which side of the deal. |
| `02-workflow.drawio` | Diagram — **How it works**: the monthly rhythm (7 numbered steps). |
| `02-workflow.md` | Explanation — the steps, who does what (pharmacy / SiroQ / operator). |
| `03-data-safety.drawio` | Diagram — **Privacy / Control / On the record** promise. |
| `03-data-safety.md` | Explanation — how the pharmacies' data is kept private and safe. |
| `04-technical-workflow.drawio` (3 pages) | Diagram — **Technical deep-dive**: ingestion & workspace, analysis engine block producers, report block model + publish + delivery. |
| `04-technical-workflow.md` | Technical walkthrough 1:1 with the diagram — real tables/functions, live demo proof points, honest pending list, opening questions. |
| `05-capabilities-brief.md` | Matrix — **Built / Pending / Open terms** for the scope conversation. |
| `README.md` | This index + presentation guide. |

## How to present it

1. Start with the overview (`01-overview.drawio`) — set the frame: "This is a
   system *you* run to deliver monthly data advice to *your* pharmacies."
2. Walk the workflow (`02-workflow.drawio`) — emphasize how little effort each
   monthly cycle takes for the operator (steps 2, 3, 5, 6 are automatic), and
   that the buyer adds value at step 4.
3. Close with data safety (`03-data-safety.drawio`) — the trust argument: your
   pharmacies' data is separate, governed by rules you control, and on the record.
4. Refer to the matching `.md` for talking points; the diagrams alone carry the
   conversation.

## Deep-dive track (showcase → scope)

1. Frame that this is a working system, not a mockup: run the 30-second script in
   `04-technical-workflow.md` §0 live — login, workspace, add a table + chart
   + engine insight, **Preview report**, publish.
2. Use `04-technical-workflow.drawio` page-by-page to explain *what you did in
   the browser and what the system did underneath* (page 1 = upload+ops,
   page 2 = every analysis becomes a persisted block, page 3 = block model +
   publish + delivery).
3. Hand the floor to `05-capabilities-brief.md`: "Here is what runs today, here
   is what is scoped and planned, here are the open terms." Position the four
   pending items as scope/timeline levers — never as doubts.
4. End with the §6 questions in `04-technical-workflow.md` (operator model,
   monthly cycle size, which blocks are must-haves, delivery channel).

## Notes

- This is a **customer-facing** summary; technical detail lives in
  `../SPECS.md` and `../OPS.md`.
- The system is fully built end-to-end; nothing here promises features that do
  not exist.
- The purchaser is the operator; if asked "who benefits?", the honest answer is:
  the pharmacies benefit from the advice, and you benefit by owning and running
  a scalable service they pay for.
- `04-technical-workflow.drawio` relies on the app being reachable for the live
  demo (§0 credentials in the matching `.md`); dry-run the env before the demo.
- Open the `.drawio` files in draw.io to edit (https://app.diagrams.net).