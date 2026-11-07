// Live Claude calls for step 3. Skipped unless ANTHROPIC_API_KEY is set and RUN_LIVE=1:
//   RUN_LIVE=1 npx vitest run tests/decide.live.test.ts
import { describe, expect, it } from "vitest";
import { FAKE_SALE_ORDER, FILL_ORDER, FIXTURE_NOW, type FixtureOrder } from "@/fixtures/demo";
import { getDecideModel } from "@/lib/model";
import type { ScoredCandidate } from "@/lib/schemas";
import { SALE_EVENTS } from "@/workflows/standing-order/config";
import { decide } from "@/workflows/standing-order/steps/decide";

const live = Boolean(process.env.ANTHROPIC_API_KEY) && process.env.RUN_LIVE === "1";

function candidateOf(order: FixtureOrder, priceCents?: number): ScoredCandidate {
  const product = order.products[0];
  const score = order.scores.find((s) => s.productId === product.productId)!;
  const { productId: _id, ...rest } = score;
  void _id;
  return { ...product, ...rest, priceCents: priceCents ?? product.priceCents };
}

async function decideLive(order: FixtureOrder, now: string, candidate: ScoredCandidate) {
  const result = await decide(
    {
      spec: order.spec,
      candidate,
      priceHistory: order.priceHistory(now)[candidate.productId] ?? [],
      now,
      saleEvents: SALE_EVENTS,
      policy: order.policy,
    },
    { model: getDecideModel(), recordLlmCall: async () => undefined },
  );
  if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`);
  return result.output;
}

describe.skipIf(!live)("decide against Claude (live)", () => {
  it("clear fill: a real 10.8% drop with Black Friday 22 days out → fill", { timeout: 120_000 }, async () => {
    const out = await decideLive(FILL_ORDER, FIXTURE_NOW, candidateOf(FILL_ORDER));

    expect(out.decision.action).toBe("fill");
    expect(out.decision.reasoning.trim()).not.toBe("");
    expect(out.decision.reasoning).toMatch(/\$?279|drop|below|usual|discount|%/i);
  });

  it("fake sale: price was inflated to $349 last week → skip, naming the inflated price", { timeout: 120_000 }, async () => {
    const candidate = candidateOf(FAKE_SALE_ORDER);
    const out = await decideLive(FAKE_SALE_ORDER, FIXTURE_NOW, candidate);

    expect(out.priceSignals?.fakeSale.detected).toBe(true);
    expect(out.decision.action).toBe("skip");
    expect(out.decision.reasoning.trim()).not.toBe("");
    expect(out.decision.reasoning).toMatch(/349/);
  });

  it("just before Black Friday: small discount on 2026-11-24 → hold", { timeout: 120_000 }, async () => {
    const now = "2026-11-24T15:00:00.000Z";
    const out = await decideLive(FILL_ORDER, now, candidateOf(FILL_ORDER, 26900)); // 3.6% below the usual $279

    expect(out.decision.action).toBe("hold");
    expect(out.decision.reasoning.trim()).not.toBe("");
    expect(out.decision.reasoning).toMatch(/black friday/i);
  });
});
