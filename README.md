# Standing Orders

Limit orders for shopping. You place a standing order in plain English ("a good 27-inch IPS monitor for coding,
under $300, free returns"), and an agent watches the market via Channel3, judges which products are acceptable
substitutes, and buys through PayPal when the price qualifies. It also refuses to buy when the deal isn't real, such
as a "sale" price after the list price was inflated the week before. Built for the PayPal AI Hackathon 2026, targeting
Best Use of Agentic Commerce, Best Use of Channel3, Best Use of Render, and Most Creative.

## How it works

Each standing order runs as its own Render Workflow through five steps: parse intent, search and score, decide,
guardrails, and execute. The LLM proposes (it turns the request into a spec, scores candidates, and picks
fill / hold / ask / skip); plain code enforces the guardrails (caps, merchant allowlist, kill switch) and is the only
thing that ever calls PayPal. There are two checkout tiers: our agent-ready sandbox store is captured automatically
with the user's PayPal Vault payment method, and every other merchant gets a one-tap approval link instead.

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
- `workflows/standing-order/run-cycle.ts` — in-memory chaining of steps 2–5
- `workflows/standing-order/price-signals.ts` — fake-sale detection
- `lib/paypal.ts`, `lib/channel3.ts` — the only places those APIs are called
- `db/migrations/0001_init.sql` — schema
- `fixtures/demo.ts`, `fixtures/fakes.ts` — demo orders and fake clients

## Demo: full workflow

```sh
npm run db:migrate && npm run db:seed
npm run workflow:smoke
```

The script drives both seeded orders through the real steps against Postgres and the PayPal sandbox (tier 2 only, no Vault, no Anthropic calls). For the monitor it prints an approval link: click it, log in as the sandbox personal buyer, approve, come back and press Enter to capture. The headphones are skipped automatically and the fake-sale reasoning is printed, with no PayPal call.

By default the scoring and decide steps use fixture models and search uses fixture products, so tests and CI need no API key. `USE_LIVE_MODEL=true npm run workflow:smoke` runs both the scoring step and the decide step against live Claude (needs `ANTHROPIC_API_KEY`), and each live call is recorded in `llm_calls`. `USE_LIVE_CHANNEL3=true` makes search call the real Channel3 API (needs `CHANNEL3_API_KEY`); the two flags are independent, and the run prints the active modes first. `USE_LIVE_CHANNEL3=true USE_LIVE_MODEL=true npm run workflow:smoke` now scores real Channel3 products with live Claude, then decides on the top one. Live failures are reported, never replaced by the fixtures. Two limits to expect, not bugs: Channel3 returns no price history, so the fake-sale refusal still depends on the seeded `price_points` (keyed to the seeded product ids), and the scorer only sees each product's title, merchant and price, so a must-have it cannot show (such as free returns) fails and can leave a live order with no candidate. `npm run channel3:smoke` is a one-call connectivity check that prints five live results.

## Orders API

Orders belong to `DEMO_USER_ID` (no auth yet). `POST /api/orders` inserts the order and runs the parse-intent step to fill in its spec: with `USE_LIVE_MODEL=true` that is live Claude, otherwise the fixture parser, which only recognises the two seeded intents. If the parse fails the order is still created, as `needs_review`, and the response carries a `warning`.

```sh
curl -X POST http://localhost:3000/api/orders   -H 'Content-Type: application/json'   -d '{"rawIntent":"a good 27-inch IPS monitor for coding, under $300, free returns","perOrderCapCents":30000,"monthlyCapCents":60000,"merchantAllowlist":["acme-electronics"]}'
# 201 {"id":"…","status":"active","spec":{…}}

curl http://localhost:3000/api/orders          # list, newest first, with each order's latest decision action
curl http://localhost:3000/api/orders/<id>     # spec, latest candidate, decisions, open approvals, fills
curl -X POST http://localhost:3000/api/orders/<id>/pause
curl -X POST http://localhost:3000/api/orders/<id>/cancel
```

Statuses: `active`, `needs_review`, `paused`, `filled`, `cancelled`. Only `active` orders may be advanced by a cycle run (`RUNNABLE_STATUSES` in `lib/orders.ts`), so paused, cancelled, filled and needs-review orders are skipped by the future tick loop. A captured tier-2 approval sets the order to `filled`. Nothing runs cycles on a schedule yet; `npm run workflow:smoke` is still the only driver.

## Tests

```sh
npm test
```

25/25 passing. The refusal case (a fake sale where the list price was inflated last week) is covered end to end on
fixture data, with no network calls.

## Status

Hackathon prototype running against the PayPal sandbox. No real money moves.
