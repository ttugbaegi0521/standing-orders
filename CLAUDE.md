# Standing Orders — limit orders for shopping

PayPal AI Hackathon 2026 entry. Deadline: **Thu Nov 12, 2026, 3:00 PM EST** (submit by noon).
Prize targets: Best Use of Agentic Commerce (primary), Best Use of Channel3, Best Use of Render, Most Creative.
Hard requirement from the organizers: the project must meaningfully use both PayPal and AI.

## What it is

A user places a standing order in natural language ("a good 27-inch IPS monitor for coding, under $300, free returns").
An agent watches the market via Channel3, judges acceptable substitutes, decides when to buy, and completes the purchase
with PayPal — automatically when the merchant supports agent checkout, or via a one-tap approval link otherwise.
Guardrails (caps, merchant allowlist, kill switch, visible reasoning) are the headline feature.

The demo must show one order that **fills** in the PayPal sandbox and one the agent **refuses** (fake "sale" where the
list price was inflated last week). The refusal is what makes judges trust it.

## Stack

- Next.js (App Router, TypeScript) — UI + API routes, deployed on Render
- Postgres on Render
- Render Workflows — one long-running workflow per standing order
- PayPal sandbox via the PayPal Agent Toolkit (TypeScript) / REST: Orders, Vault (saved payment method), capture
- Channel3 API — product search and prices
- Claude via Vercel AI SDK (structured output + tool use) for steps 1–3 below
- Secrets in Render env vars: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `CHANNEL3_API_KEY`, `ANTHROPIC_API_KEY`, `DATABASE_URL`

## Architecture

Trust flows one way: humans act in the Next.js app; the model proposes inside the workflow; plain code enforces
guardrails and is the only thing that touches PayPal.

Workflow steps (one Render Workflow instance per order, steps idempotent, `fills` row is the lock):

1. **Parse intent** (LLM, structured output) → spec JSON: category, must-haves, nice-to-haves, max price, constraints,
   plain-English restatement for the user to confirm.
2. **Search and score** (Channel3 + LLM) → query Channel3 from the spec, then score 10–30 candidates: fit 0–100,
   which must-haves pass/fail, one-line reasoning. Code filters below threshold.
3. **Decide** (LLM) → one of `fill | hold | ask | skip` with reasoning, given top candidate, price history, today's date
   and upcoming sale events (Black Friday is Nov 27, 2026), user caps and allowlist.
   - hold: likely to drop further → sleep, re-run from step 2
   - skip: fake sale (list price raised recently) or spec no longer met
   - ask: fits but exceeds a cap or merchant not allowlisted → approval push
4. **Guardrails** (code only, no model) → per-order cap, monthly cap, allowlist, kill switch. Runs after the model's
   decision; can downgrade `fill` to `ask` or `skip`. Never skippable.
5. **Execute or notify** (code only) →
   - Tier 1 (merchant is our own agent-ready sandbox store): create PayPal order with the user's vaulted payment
     method, capture, write `fills`.
   - Tier 2 (any other merchant): create PayPal order, write `approvals` row, email/push a one-tap approval link.
     `POST /approvals/:token` captures and resumes the workflow.
   - Always write a `decisions` row and send the user a two-sentence explanation.

The LLM never calls PayPal. Price polling, Channel3 queries, and order creation are ordinary functions.

## Data model (Postgres)

- `users` — id, email, encrypted PayPal vault token (never put in LLM context)
- `standing_orders` — user_id, raw_intent, spec (jsonb), max_price, per_order_cap, monthly_cap, merchant_allowlist (text[]),
  status (`active|filled|paused|cancelled`), workflow_id
- `candidates` — order_id, channel3_product_id, merchant, price, fit_score, fit_reasoning, seen_at
- `price_points` — product_id, price, observed_at (powers fake-sale detection and timing)
- `decisions` — order_id, action, reasoning, llm_input_hash, created_at (audit trail)
- `fills` — order_id (unique), paypal_order_id, amount, status
- `approvals` — decision_id, token, expires_at, resolved_at

## API routes

- `POST /api/orders` — create row, start workflow
- `GET /api/orders/:id` — status, candidates, decisions
- `POST /api/orders/:id/pause`, `POST /api/orders/:id/cancel`
- `POST /api/approvals/:token` — tier-2 capture + resume
- `POST /api/webhooks/paypal` — capture confirmations
- `POST /api/admin/price-override` — **demo only**: inject a fake price for a product id into the loop

## Demo controls

Channel3 prices won't move on command. Keep real Channel3 data for search/display; use the price override to trigger a
fill. Seed two orders: one that fills, one that is refused as a fake sale (seed `price_points` with an inflated
list price from last week). Fixture-test steps 2 and 3 so the refusal is deterministic.

## Build order (Nov 5 → Nov 12)

- Thu night: PayPal sandbox business + personal accounts, Channel3 and Render keys, repo scaffold.
- Fri: Channel3 search returning real products; sandbox store (one page, 3 products) with PayPal order create +
  capture working by hand; DB schema + migrations.
- Sat: step 1 (intent → spec), step 2 scoring, step 3/4 decision engine with caps and allowlist; fixture tests.
- Sun: Render Workflow running steps 1–5 end to end with price override; Vault setup; first agent-driven sandbox fill.
- Mon: tier-2 approval links; fake-sale and "wait for Black Friday" logic; decision log in the UI.
- Tue: UI polish, seed demo data, rough demo video.
- Wed: final video (<3 min: place order → workflow graph → price change → fill in PayPal → refused order → reasoning),
  Devpost writeup, deploy to Render, test live URL from a clean browser.
- Thu AM: submit by noon. No code changes after.

## Cut order if behind

1. Cart-level orders (don't start)
2. Black Friday timing logic
3. Fake-sale detection (keep a hard-coded refusal fixture for the demo)
4. Vault automatic fill → fall back to approval links everywhere
5. Tier-2 entirely → sandbox store only

## Submission checklist

- Public repo; README names exactly where PayPal, Claude, Channel3, and Render Workflows are used
- Live Render URL
- Video shows a fill, a refusal, and the workflow graph
- Devpost text explicitly tags Agentic Commerce, Channel3, Render

## Commands

- `npm run dev` / `npm run build`
- `npm test` — vitest; fixture tests for steps 1–4 and the fill/refusal cycle (no network)
- `npm run typecheck` — `next typegen` then `tsc` (route types like `RouteContext` are generated)
- `npm run db:migrate` / `npm run db:seed` — need `DATABASE_URL` (env, `.env`, or `.env.local`, which overrides `.env`); seed is idempotent

## Conventions

- Money is integer US cents everywhere (`*_cents` columns, `priceCents` fields)
- Demo fixtures live in `fixtures/demo.ts`; in-memory fakes for Channel3/PayPal/models in `fixtures/fakes.ts`

- TypeScript strict; zod schemas for every LLM output and every API body
- Every PayPal call goes through `lib/paypal.ts`; every Channel3 call through `lib/channel3.ts`
- Workflow steps in `workflows/standing-order/steps/*.ts`, one file per step, pure where possible
- Log every LLM call (input hash, output) to `decisions` or a `llm_calls` table — judges will ask for the audit trail
