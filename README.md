# Standing Orders

Limit orders for shopping. You place a standing order in plain English ("a good 27-inch IPS monitor for coding,
under $300, free returns"), and an agent watches the market via Channel3, judges which products are acceptable
substitutes, and buys through PayPal when the price qualifies. It also refuses to buy when the deal isn't real, such
as a "sale" price after the list price was inflated the week before. Built for the PayPal AI Hackathon 2026, targeting
Best Use of Agentic Commerce, Best Use of Channel3, Best Use of Render, and Most Creative.

## How it works

Each standing order goes through five steps: parse intent, search and score, decide, guardrails, and execute.
The request is parsed once, when the order is created; after that every check is one cycle of the other four
steps (`runOrderCycle`). Scheduling is a Render cron job that POSTs `/api/tick` every 15 minutes; the tick selects
the active orders that are due and advances each by one cycle. The LLM proposes (it turns the request into a spec, scores candidates, and picks
fill / hold / ask / skip); plain code enforces the guardrails (caps, merchant allowlist, kill switch) and is the only
thing that ever calls PayPal. There are two checkout tiers in the code: an agent-ready merchant is captured
automatically with the user's PayPal Vault payment method, and every other merchant gets a one-tap approval link.
The demo uses approval links throughout.

## Where each technology is used

- **PayPal.** Orders API create and capture, all in `lib/paypal.ts` (the only file that calls PayPal), against the
  sandbox with real captures. Purchases go through the tier-2 one-tap approval flow: the agent creates the PayPal
  order, the buyer approves it on PayPal, and `/approvals/[token]` captures it. `/store` is our own sandbox merchant
  with PayPal checkout. Captures are confirmed by a verified webhook (`/api/webhooks/paypal`).
- **Claude (AI).** Three steps, each through the Vercel AI SDK with a zod-validated structured output:
  `parse-intent.ts` turns free text into a spec, `search-and-score.ts` scores each candidate for fit, and `decide.ts`
  picks fill / hold / skip / ask with written reasoning, including the fake-sale refusal. Every live call is
  audit-logged to `llm_calls`. Claude never calls PayPal.
- **Channel3.** Live product search in `lib/channel3.ts` (the only file that calls Channel3). Its results are the
  real candidates that get scored, and each price it returns is recorded to build price history.
- **Render.** A Blueprint (`render.yaml`) with the web service, Postgres, and a cron job. The cron job POSTs
  `/api/tick` every 15 minutes, and that is what makes orders "standing" in production.

What is demo-only: the fake-sale refusal in the demo relies on seeded price history, because Channel3 returns no
history and detection needs a baseline older than 14 days; a live product can only be flagged after about two weeks
of recorded prices. The automatic tier-1 path (capture with a PayPal Vault payment method, no approval) is
implemented and tested against fakes, but the demo uses approval links because Vault setup is blocked in our sandbox.

## Run locally

Requires Node 24 and Postgres 17 (13+ works; the schema uses the built-in `gen_random_uuid()`). The first time,
`DATABASE_URL` must point at an empty database.

```sh
cp .env.example .env        # then fill in the keys
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

## Where things live

- `app/` — Next.js App Router pages and API routes
- `workflows/standing-order/steps/parse-intent.ts` — LLM: request → spec
- `workflows/standing-order/steps/search-and-score.ts` — Channel3 + LLM candidate scoring
- `workflows/standing-order/steps/decide.ts` — LLM: fill / hold / ask / skip
- `workflows/standing-order/steps/guardrails.ts` — plain code: caps, allowlist, kill switch; can only make a decision more cautious
- `workflows/standing-order/steps/execute.ts` — the only step that calls PayPal; handles tier 1 and tier 2
- `workflows/standing-order/run-order.ts` — the persisted cycle for one order (`runOrderCycle`) and the tick that runs every due order (`tickOnce`)
- `workflows/standing-order/run-cycle.ts` — in-memory chaining of steps 2–5, used by the fixture tests
- `app/api/tick/route.ts`, `render.yaml` — the endpoint the Render cron job calls, and the Blueprint that defines it
- `workflows/standing-order/price-signals.ts` — fake-sale detection
- `lib/paypal.ts`, `lib/channel3.ts` — the only places those APIs are called
- `db/migrations/0001_init.sql` — schema
- `fixtures/demo.ts`, `fixtures/fakes.ts` — demo orders and fake clients

## Demo: the full cycle from the command line

```sh
npm run db:migrate && npm run db:seed
npm run workflow:smoke
```

The script drives both seeded orders through the real steps against Postgres and the PayPal sandbox (tier 2 only, no Vault, no Anthropic calls). For the monitor it prints an approval link: click it, log in as the sandbox personal buyer, approve, come back and press Enter to capture. The headphones are skipped automatically and the fake-sale reasoning is printed, with no PayPal call.

`workflow:smoke` keeps its own opt-in flags so the seeded demo runs on demand: by default it uses fixture models and fixture search, so tests and CI need no API key. `USE_LIVE_MODEL=true npm run workflow:smoke` runs the scoring and decide steps against live Claude (needs `ANTHROPIC_API_KEY`), and each live call is recorded in `llm_calls`. `USE_LIVE_CHANNEL3=true` makes its search call the real Channel3 API (needs `CHANNEL3_API_KEY`); the two flags are independent, and the run prints the active modes first. `USE_LIVE_CHANNEL3=true USE_LIVE_MODEL=true npm run workflow:smoke` scores real Channel3 products with live Claude, then decides on the top one. Live failures are reported, never replaced by the fixtures. Two limits to expect, not bugs: Channel3 returns no price history, so the fake-sale refusal still depends on the seeded `price_points` (keyed to the seeded product ids), and the scorer only sees each product's title, merchant and price, so a must-have it cannot show (such as free returns) fails and can leave a live order with no candidate. `npm run channel3:smoke` is a one-call connectivity check that prints five live results.

## Orders API

Orders belong to `DEMO_USER_ID` (no auth yet). `POST /api/orders` inserts the order and runs the parse-intent step to fill in its spec. **The app runs live by default**: with `ANTHROPIC_API_KEY` set that is real Claude, and only without a key does it fall back to the fixture parser, which recognises just the two seeded intents (so almost every new order would be `needs_review`). `POST /api/orders/[id]/check` and `POST /api/tick` always run live (real Claude and Channel3) and answer 503 without `ANTHROPIC_API_KEY` and `CHANNEL3_API_KEY`. `USE_LIVE_MODEL=false` forces the fixture parser even with a key; it is an override, not something you need to set. If the parse fails the order is still created, as `needs_review`, and the response carries a `warning`.

```sh
curl -X POST http://localhost:3000/api/orders   -H 'Content-Type: application/json'   -d '{"rawIntent":"a good 27-inch IPS monitor for coding, under $300, free returns","perOrderCapCents":30000,"monthlyCapCents":60000,"merchantAllowlist":["acme-electronics"]}'
# 201 {"id":"…","status":"active","spec":{…}}

curl http://localhost:3000/api/orders          # list, newest first, with each order's latest decision action
curl http://localhost:3000/api/orders/<id>     # spec, latest candidate, decisions, open approvals, fills
curl -X POST http://localhost:3000/api/orders/<id>/pause
curl -X POST http://localhost:3000/api/orders/<id>/cancel
```

Statuses: `active`, `needs_review`, `paused`, `filled`, `cancelled`. Only `active` orders may be advanced by a cycle run (`RUNNABLE_STATUSES` in `lib/orders.ts`), so paused, cancelled, filled and needs-review orders are skipped by the tick loop. A captured tier-2 approval sets the order to `filled`. Cycles run on a schedule through the watch loop (`POST /api/tick`), which a Render cron job calls every 15 minutes in production (see Deploy on Render).

## Kill switch

The toggle in the `/orders` header (or `GET`/`POST /api/kill-switch`; `{ "on": true }` sets it, no body flips it) sets `users.kill_switch`. While it is on a banner says so and the watch loop, both on a tick and on Check now, never buys: if the model proposes a purchase the cycle stops before step 5 and records the decision as `skip` with `guardrail_reasons: ["kill_switch"]` and the reasoning "Agent paused by kill switch — no purchase made", so no fill, approval or PayPal order is created. Orders keep being checked and prices recorded; only buying stops. The order page flags those decisions in the log.

Each check also stores the top five scored products (migration `0007_candidates.sql` adds `candidates.chosen`), and the order page lists them under "Considered N products via Channel3" with the pick marked. Note the label describes the live path: orders created by `db:seed`/`demo-run` show fixture products under the same label.

## Demo: the refusal and the purchase in the browser, from seed data alone

```sh
npm run db:migrate && npm run db:seed
npm run demo-run
```

`db:seed` writes both demo orders with nine price observations each over 25 days, plus each order's current candidate, and checks the history against the real thresholds (`price-signals.ts`), refusing to seed if it would not read the intended way. Reseeding resets the demo orders' decisions, fills and price points. `demo-run` then runs one real persisted cycle per order over that candidate and history, so the decisions are produced by the decide step, not inserted:

- **Headphones: the refusal.** About $229 for weeks, a jump to $349 eight days ago, now "on sale" at $239: a fake sale. The order is skipped with the reasoning shown, and PayPal is stubbed to refuse, so this order can never buy.
- **Monitor: accept, approve, buy.** About $279 for weeks, now $249 (10.8% below baseline, the 30-day low, no spike): a genuine drop, so the agent chooses to buy instead of waiting for Black Friday. It goes through tier 2: a pending fill, an approval, and an un-captured PayPal sandbox order (needs `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET`). `demo-run` prints the approval URL. **You finish the purchase in the browser:** open the monitor order, click **Approve purchase**, approve on PayPal as the sandbox buyer, and the return page captures the payment and flips the order to **Filled**. Tier 2 is used whatever `AGENT_READY_MERCHANTS` says, since Vault is blocked in the sandbox. Running `demo-run` again while that approval is open does not create a second PayPal order.

The decide step is live Claude when `ANTHROPIC_API_KEY` is set (`USE_LIVE_MODEL=false` forces the fixture model), otherwise the fixture model. Search and scoring use the fixtures, so Channel3 is never called. The monitor's drop is only just past the 10% line the decide step treats as worth buying with a sale event nearby, so a live model can occasionally choose to wait; `demo-run` says so, and rerunning or using the fixture model gives the deterministic result. If you run `demo-run` right after seeding, the current price is not recorded a second time (an identical price within the last hour is skipped).

## The watch loop (`POST /api/tick`, `npm run tick`)

This is what makes an order "standing". Each tick claims every `active` order that is due (`next_check_at` null or past; paused, cancelled, filled and needs-review orders are never selected), and for each one runs a full persisted cycle: live Channel3 search, live Claude scoring, price history, live Claude decide, guardrails, then execute with the real PayPal sandbox. A hold, skip or error schedules the next check `HOLD_RECHECK_MINUTES` later (default 60); a pending approval waits for its expiry and is not duplicated; a captured fill marks the order `filled`. One order failing does not stop the batch, and its error is in the response.

```sh
npm run tick                                    # one tick, pretty-printed
curl -X POST http://localhost:3000/api/tick     # the same, as JSON: { checked, results }
```

Run one of these on a schedule; nothing inside the app schedules itself. In production the Render cron job in `render.yaml` does it every 15 minutes (see Deploy on Render). Unlike `workflow:smoke`, the loop is always live and needs `ANTHROPIC_API_KEY` and `CHANNEL3_API_KEY` (the endpoint answers 503 without them instead of using fixtures), plus PayPal credentials. Set `TICK_SECRET` to require `Authorization: Bearer <secret>`; without it anyone who can reach the endpoint can trigger live calls.

Every tick also records the price Channel3 returns for each product it saw into `price_points` (skipping a product whose price is unchanged within the last hour), so history builds up for real products. Fake-sale detection reads that history, but it needs more than a few ticks: it compares a recent price peak (the last 14 days) with a baseline of at least 3 observations older than 14 days, so a live product needs roughly two weeks of history before it can be flagged. Until then the decide step sees no baseline and judges on the price alone.

Cancelling an order also blocks its outstanding approval links: capturing one answers 409 and rejects the approval.

## The app

- `/` landing; `/orders` your orders with status and latest decision; `/orders/new` create one (you confirm the parsed restatement before it is watched).
- `/orders/[id]` the parsed spec, current candidate, every decision (with the guardrail changes spelled out), any open approval, purchases, and **Check now** / Pause / Cancel. Check now runs one live cycle immediately (`POST /api/orders/[id]/check`; needs `ANTHROPIC_API_KEY` and `CHANNEL3_API_KEY`, answers 503 without them).
- `/approvals/[token]` is where PayPal returns the buyer after they approve; it captures the payment and shows the confirmation.
- Timestamps show in your own timezone (with a relative "2 hours ago" and the full time on hover); the first paint shows UTC until the browser swaps in local time. The dashboard ranks watching orders first and mutes filled and cancelled ones, with a count line on top. The detail page charts the current candidate's price history against your max; it needs two or more recorded prices (one is recorded each time the agent checks), so a new order shows a quiet empty state until it has been checked a couple of times.
- Orders belong to `DEMO_USER_ID`; there is no sign-in yet.

## Deploy on Render

`render.yaml` is a Render Blueprint with three resources:

- `standing-orders-db`: Postgres.
- `standing-orders`: the Next.js web service. It builds with `npm install --include=dev && npm run build` and starts
  with `npm run db:migrate && npm run start`, so migrations are applied before it serves.
- `standing-orders-tick`: a cron job that runs every 15 minutes (`*/15 * * * *`) and POSTs `/api/tick` on the web
  service with the tick secret.

**The cron job is what makes orders "standing" in production.** Nothing inside the app schedules itself: every 15
minutes Render calls `/api/tick`, which checks every due active order (Channel3 search, Claude scoring and decision,
guardrails, PayPal). That scheduled loop, the web service and the database are the whole of this project's use of
Render.

Steps:

1. In the Render dashboard choose **New → Blueprint** and connect this repo. Render reads `render.yaml`.
2. Fill in the secrets it asks for: `ANTHROPIC_API_KEY`, `CHANNEL3_API_KEY`, `PAYPAL_CLIENT_ID`,
   `PAYPAL_CLIENT_SECRET`, `PAYPAL_API_BASE` (`https://api-m.sandbox.paypal.com`), `VAULT_ENCRYPTION_KEY`
   (`openssl rand -base64 32`), `DEMO_USER_ID` (`00000000-0000-4000-8000-000000000001`, the seeded demo user),
   `AGENT_READY_MERCHANTS` (empty for approval links everywhere), and `TICK_SECRET`. Use the same `TICK_SECRET` on
   the web service and the cron job. `DATABASE_URL` is wired to the database automatically.
3. After the first deploy, copy the web service's URL (for example `https://standing-orders.onrender.com`) into
   `APP_BASE_URL` and `STORE_BASE_URL` on the web service and `APP_URL` on the cron job, with no trailing slash, then
   redeploy. PayPal return and cancel links are built from these, so until they are set, approvals return to the
   wrong host.
4. In the PayPal developer dashboard, point the sandbox app's webhook at `https://<your-host>/api/webhooks/paypal`
   and put its webhook id in `PAYPAL_WEBHOOK_ID`. If you registered return URLs for the sandbox app, change them to
   the Render host too.
5. Seed the demo data once with `npm run db:seed`, either from the web service's Shell tab or locally with
   `DATABASE_URL` set to the database's external connection string. Do not add it to the start command: reseeding
   resets the demo orders' decisions, fills and price points.
6. Check the loop: trigger the cron job once from the dashboard (**Trigger Run**). A non-2xx answer from `/api/tick`
   (401 for a wrong secret, 503 for missing API keys) fails the run, and the log shows why.

The cron job needs a paid instance type (Render has no free cron jobs); the web service and database are set to the
free plan, where the web service sleeps when idle and wakes on the next request, including the cron job's.

## Tests

```sh
npm test
```

106 passing. The refusal case (a fake sale where the list price was inflated last week) is covered end to end on
fixture data, with no network calls.

## Status

Hackathon prototype running against the PayPal sandbox. No real money moves.
