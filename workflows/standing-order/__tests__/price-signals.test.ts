import { describe, expect, it } from "vitest";
import { FAKE_SALE_ORDER, FILL_ORDER, FIXTURE_NOW } from "@/fixtures/demo";
import type { PricePoint } from "@/lib/schemas";
import { analyzePriceHistory } from "../price-signals";

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (d: number) => new Date(Date.parse(FIXTURE_NOW) - d * DAY_MS).toISOString();

describe("analyzePriceHistory", () => {
  it("flags the fixture fake sale: list price inflated last week, 'sale' price above the old baseline", () => {
    const history = FAKE_SALE_ORDER.priceHistory(FIXTURE_NOW)["ch3-hp-quietwave9"];
    const s = analyzePriceHistory(history, 23900, FIXTURE_NOW);

    expect(s.baselineCents).toBe(22900);
    expect(s.fakeSale.detected).toBe(true);
    expect(s.fakeSale.inflatedPeakCents).toBe(34900);
    expect(s.fakeSale.inflatedAt).toBe(daysAgo(8));
    expect(s.fakeSale.claimedDiscountPct).toBeCloseTo(0.315, 3);
    expect(s.pctVsBaseline).toBeGreaterThan(0);
  });

  it("does not flag the fixture genuine drop", () => {
    const history = FILL_ORDER.priceHistory(FIXTURE_NOW)["sbx-mon-lumen27q"];
    const s = analyzePriceHistory(history, 24900, FIXTURE_NOW);

    expect(s.baselineCents).toBe(27900);
    expect(s.fakeSale.detected).toBe(false);
    expect(s.pctVsBaseline).toBeCloseTo(-0.108, 3);
  });

  it("does not flag a spike followed by a real drop below baseline", () => {
    const history: PricePoint[] = [
      ...[40, 35, 30, 25, 20].map((d) => ({ priceCents: 22900, observedAt: daysAgo(d) })),
      { priceCents: 34900, observedAt: daysAgo(5) },
    ];
    const s = analyzePriceHistory(history, 19900, FIXTURE_NOW);

    expect(s.fakeSale.inflatedPeakCents).toBe(34900);
    expect(s.fakeSale.detected).toBe(false);
  });

  it("makes no fake-sale call without enough baseline history", () => {
    const history: PricePoint[] = [
      { priceCents: 22900, observedAt: daysAgo(20) },
      { priceCents: 34900, observedAt: daysAgo(5) },
    ];
    const s = analyzePriceHistory(history, 23900, FIXTURE_NOW);

    expect(s.baselineCents).toBeNull();
    expect(s.fakeSale.detected).toBe(false);
  });

  it("ignores observations from the future", () => {
    const s = analyzePriceHistory([{ priceCents: 100, observedAt: daysAgo(-1) }], 200, FIXTURE_NOW);
    expect(s.observations).toBe(0);
  });
});
