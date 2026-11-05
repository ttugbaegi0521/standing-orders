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

## Tests

```sh
npm test
```

25/25 passing. The refusal case (a fake sale where the list price was inflated last week) is covered end to end on
fixture data, with no network calls.

## Status

Hackathon prototype running against the PayPal sandbox. No real money moves.
