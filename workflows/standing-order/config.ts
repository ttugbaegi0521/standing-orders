import type { SaleEvent } from "@/lib/schemas";

/** Candidates scoring below this (0–100) are dropped by code after step 2. */
export const FIT_THRESHOLD = 70;
export const MAX_CANDIDATES = 30;

/** Our own agent-ready sandbox store: the only tier-1 (auto-capture) merchant. */
export const SANDBOX_STORE_MERCHANT = "standing-orders-sandbox-store";

export const APPROVAL_TTL_HOURS = 48;

export const SALE_EVENTS: SaleEvent[] = [
  { name: "Black Friday", date: "2026-11-27" },
  { name: "Cyber Monday", date: "2026-11-30" },
];

/** Fake-sale detection (see price-signals.ts). */
export const PRICE_HISTORY = {
  lookbackDays: 60,
  /** Observations newer than this are "recent"; older ones form the baseline. */
  recentDays: 14,
  minBaselinePoints: 3,
  /** A recent peak this far above baseline counts as an inflated list price. */
  inflationMinPct: 0.15,
  /** A "sale" price within this fraction of baseline (or above it) is not a real discount. */
  fakeSaleTolerancePct: 0.02,
} as const;
