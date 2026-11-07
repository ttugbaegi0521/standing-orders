// The seeded demos only work if the seeded price history reads the intended way. scripts/seed.ts checks the same
// thing at seed time; this keeps it true in CI, and checks what the fixture decide step does with it.
import { describe, expect, it } from "vitest";
import { FAKE_SALE_ORDER, FILL_ORDER, FIXTURE_NOW, type FixtureOrder } from "@/fixtures/demo";
import { rulesDecideModel } from "@/fixtures/fakes";
import type { ScoredCandidate } from "@/lib/schemas";
import { PRICE_HISTORY, SALE_EVENTS } from "@/workflows/standing-order/config";
import { analyzePriceHistory } from "@/workflows/standing-order/price-signals";
import { decide } from "@/workflows/standing-order/steps/decide";
import { applyGuardrails } from "@/workflows/standing-order/steps/guardrails";

const DAY = 86_400_000;
// A real-looking "now" three weeks before Black Friday (so a sale event is inside the hold window), plus a
// frozen one and one far away: the history is relative to now, so it must hold at any of them.
const NOWS = ["2026-11-07T08:00:00.000Z", FIXTURE_NOW, "2027-03-15T12:00:00.000Z"];

function candidateOf(order: FixtureOrder): ScoredCandidate {
  const product = order.products[0];
  const { productId: _id, ...score } = order.scores.find((s) => s.productId === product.productId)!;
  void _id;
  return { ...product, ...score };
}

describe.each([
  ["monitor (genuine drop)", FILL_ORDER],
  ["headphones (fake sale)", FAKE_SALE_ORDER],
])("seeded history: %s", (_name, order) => {
  const product = order.products[0];

  it.each(NOWS)("is sparse and has enough baseline points, at %s", (now) => {
    const history = order.seedHistory!(now)[product.productId];
    const baseline = history.filter((p) => Date.parse(p.observedAt) < Date.parse(now) - PRICE_HISTORY.recentDays * DAY);
    expect(history.length).toBeGreaterThanOrEqual(8);
    expect(history.length).toBeLessThanOrEqual(10);
    expect(baseline.length).toBeGreaterThanOrEqual(PRICE_HISTORY.minBaselinePoints);
    // The last observation is "today" at the fixture price, so the chart ends on the candidate's price.
    expect(history[history.length - 1].priceCents).toBe(product.priceCents);
  });

  it.each(NOWS)("reads the way it is declared to, at %s", (now) => {
    const signals = analyzePriceHistory(order.seedHistory!(now)[product.productId], product.priceCents, now);
    const { fakeSale, minDropPct } = order.seedExpectation!;
    expect(signals.fakeSale.detected).toBe(fakeSale);
    if (minDropPct !== undefined) {
      expect(signals.pctVsBaseline!).toBeLessThanOrEqual(-minDropPct);
      expect(signals.lowest30dCents).toBe(product.priceCents); // at its 30-day low
      expect(signals.fakeSale.inflatedPeakCents).toBeNull(); // and no inflated peak anywhere
    }
  });
});

describe("what the fixture decide step does with the seeded history", () => {
  const run = async (order: FixtureOrder, now: string) => {
    const candidate = candidateOf(order);
    // As the cycle reads it: observations strictly before this run.
    const history = order.seedHistory!(now)[candidate.productId];
    const later = new Date(Date.parse(now) + 60_000).toISOString();
    const { output } = await decide(
      { spec: order.spec, candidate, priceHistory: history, now: later, saleEvents: SALE_EVENTS, policy: order.policy },
      { model: rulesDecideModel },
    );
    return { output, candidate };
  };

  it("monitor: buys now even with Black Friday inside the hold window", async () => {
    const now = "2026-11-07T08:00:00.000Z"; // Black Friday is 20 days away
    const { output, candidate } = await run(FILL_ORDER, now);
    expect(output.decision.action).toBe("fill");
    // Guardrails leave it alone: the sandbox store is on the allowlist and $249 is under the $300 cap.
    expect(
      applyGuardrails({ decision: output.decision, candidate, policy: FILL_ORDER.policy, killSwitch: false, monthToDateSpendCents: 0 })
        .action,
    ).toBe("fill");
  });

  it("headphones: refuses", async () => {
    const { output } = await run(FAKE_SALE_ORDER, "2026-11-07T08:00:00.000Z");
    expect(output.decision.action).toBe("skip");
    expect(output.decision.reasoning).toMatch(/fake sale/i);
  });
});
