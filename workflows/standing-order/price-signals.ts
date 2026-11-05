// Pure price-history analysis. Computed in code and handed to the step-3 model as context,
// so fake-sale detection is deterministic and testable regardless of the model.
import type { PricePoint } from "@/lib/schemas";
import { PRICE_HISTORY } from "./config";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PriceSignals {
  currentPriceCents: number;
  observations: number;
  /** Median price older than `recentDays` — what the product "normally" costs. */
  baselineCents: number | null;
  lowest30dCents: number | null;
  /** (current - baseline) / baseline; negative means cheaper than usual. */
  pctVsBaseline: number | null;
  fakeSale: {
    detected: boolean;
    /** Highest recent price, if it was inflated above baseline. */
    inflatedPeakCents: number | null;
    inflatedAt: string | null;
    /** The discount a shopper would see vs. the inflated peak. */
    claimedDiscountPct: number | null;
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function analyzePriceHistory(
  history: PricePoint[],
  currentPriceCents: number,
  nowIso: string,
): PriceSignals {
  const now = Date.parse(nowIso);
  const points = history
    .map((p) => ({ price: p.priceCents, at: Date.parse(p.observedAt), observedAt: p.observedAt }))
    .filter((p) => p.at <= now && p.at >= now - PRICE_HISTORY.lookbackDays * DAY_MS)
    .sort((a, b) => a.at - b.at);

  const recentCutoff = now - PRICE_HISTORY.recentDays * DAY_MS;
  const baselinePoints = points.filter((p) => p.at < recentCutoff);
  const recentPoints = points.filter((p) => p.at >= recentCutoff);
  const last30d = points.filter((p) => p.at >= now - 30 * DAY_MS);

  const baselineCents =
    baselinePoints.length >= PRICE_HISTORY.minBaselinePoints
      ? median(baselinePoints.map((p) => p.price))
      : null;

  const noFakeSale = {
    detected: false,
    inflatedPeakCents: null,
    inflatedAt: null,
    claimedDiscountPct: null,
  };

  let fakeSale: PriceSignals["fakeSale"] = noFakeSale;
  if (baselineCents !== null && recentPoints.length > 0) {
    const peak = Math.max(...recentPoints.map((p) => p.price));
    const inflated = peak >= baselineCents * (1 + PRICE_HISTORY.inflationMinPct);
    if (inflated) {
      const inflatedAt = recentPoints.find((p) => p.price === peak)!.observedAt;
      fakeSale = {
        detected: currentPriceCents >= baselineCents * (1 - PRICE_HISTORY.fakeSaleTolerancePct),
        inflatedPeakCents: peak,
        inflatedAt,
        claimedDiscountPct: round3((peak - currentPriceCents) / peak),
      };
    }
  }

  return {
    currentPriceCents,
    observations: points.length,
    baselineCents,
    lowest30dCents: last30d.length ? Math.min(...last30d.map((p) => p.price)) : null,
    pctVsBaseline:
      baselineCents !== null ? round3((currentPriceCents - baselineCents) / baselineCents) : null,
    fakeSale,
  };
}
