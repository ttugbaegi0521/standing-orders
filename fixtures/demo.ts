// Demo fixtures: one standing order that fills, one the agent refuses as a fake sale.
// Shared by tests (with a frozen `now`) and scripts/seed.ts (with the real now).
import type { CandidateScore, OrderPolicy, PricePoint, Product, Spec } from "@/lib/schemas";
import { SANDBOX_STORE_MERCHANT } from "@/workflows/standing-order/config";

/** Frozen clock for tests. Black Friday (Nov 27) is 22 days out. */
export const FIXTURE_NOW = "2026-11-05T15:00:00.000Z";

export const DEMO_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "demo@standing-orders.test",
};

export interface FixtureOrder {
  id: string;
  rawIntent: string;
  spec: Spec;
  policy: OrderPolicy;
  products: Product[];
  scores: CandidateScore[];
  /** Price history per product, relative to `now`. */
  priceHistory: (now: string) => Record<string, PricePoint[]>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** One observation per day from `fromDaysAgo` down to `toDaysAgo` (inclusive). */
function daily(now: string, fromDaysAgo: number, toDaysAgo: number, priceCents: number): PricePoint[] {
  const t = Date.parse(now);
  const points: PricePoint[] = [];
  for (let d = fromDaysAgo; d >= toDaysAgo; d--) {
    points.push({ priceCents, observedAt: new Date(t - d * DAY_MS).toISOString() });
  }
  return points;
}

// ---- Order A: fills (tier 1, sandbox store, genuine price drop) ----

export const FILL_ORDER: FixtureOrder = {
  id: "00000000-0000-4000-8000-00000000a001",
  rawIntent: "a good 27-inch IPS monitor for coding, under $300, free returns",
  spec: {
    category: "computer monitor",
    mustHaves: ["27-inch", "IPS panel", "free returns"],
    niceToHaves: ["1440p or higher", "USB-C with power delivery", "height-adjustable stand"],
    maxPriceCents: 30000,
    constraints: ["new condition"],
    restatement:
      "A new 27-inch IPS monitor suited to coding, under $300, from a seller with free returns.",
  },
  policy: {
    maxPriceCents: 30000,
    perOrderCapCents: 30000,
    monthlyCapCents: 60000,
    merchantAllowlist: [SANDBOX_STORE_MERCHANT, "acme-electronics"],
  },
  products: [
    {
      productId: "sbx-mon-lumen27q",
      title: 'Lumen 27Q 27" IPS 1440p USB-C Monitor',
      merchant: SANDBOX_STORE_MERCHANT,
      priceCents: 24900,
      url: null,
    },
    {
      productId: "ch3-mon-vista27c",
      title: 'Vista 27" VA Curved Monitor',
      merchant: "acme-electronics",
      priceCents: 19900,
      url: "https://example.com/vista27c",
    },
    {
      productId: "ch3-mon-clarity24",
      title: 'Clarity 24" IPS 1080p Monitor',
      merchant: "acme-electronics",
      priceCents: 14900,
      url: "https://example.com/clarity24",
    },
  ],
  scores: [
    {
      productId: "sbx-mon-lumen27q",
      fitScore: 88,
      mustHaves: [
        { requirement: "27-inch", pass: true },
        { requirement: "IPS panel", pass: true },
        { requirement: "free returns", pass: true },
      ],
      reasoning: "27-inch IPS at 1440p with USB-C power delivery; crisp text for coding.",
    },
    {
      productId: "ch3-mon-vista27c",
      fitScore: 52,
      mustHaves: [
        { requirement: "27-inch", pass: true },
        { requirement: "IPS panel", pass: false },
        { requirement: "free returns", pass: true },
      ],
      reasoning: "VA panel, not IPS, and the curve distorts straight lines of code.",
    },
    {
      productId: "ch3-mon-clarity24",
      fitScore: 41,
      mustHaves: [
        { requirement: "27-inch", pass: false },
        { requirement: "IPS panel", pass: true },
        { requirement: "free returns", pass: true },
      ],
      reasoning: "IPS but only 24 inches at 1080p.",
    },
  ],
  // Steady at $279 for six weeks; today's $249 is a real 10.8% drop.
  priceHistory: (now) => ({
    "sbx-mon-lumen27q": daily(now, 45, 1, 27900),
  }),
};

// ---- Order B: refused (list price inflated last week, then "discounted") ----

export const FAKE_SALE_ORDER: FixtureOrder = {
  id: "00000000-0000-4000-8000-00000000b001",
  rawIntent: "noise-cancelling over-ear headphones for flights, wireless, under $250",
  spec: {
    category: "headphones",
    mustHaves: ["over-ear", "active noise cancelling", "wireless"],
    niceToHaves: ["30+ hour battery", "folding design", "multipoint Bluetooth"],
    maxPriceCents: 25000,
    constraints: ["new condition"],
    restatement: "Wireless over-ear headphones with active noise cancelling for flights, under $250.",
  },
  // Deliberately permissive: caps and allowlist would let this through, so the refusal
  // can only come from the fake-sale judgement in step 3.
  policy: {
    maxPriceCents: 25000,
    perOrderCapCents: 25000,
    monthlyCapCents: 60000,
    merchantAllowlist: [SANDBOX_STORE_MERCHANT, "acme-electronics"],
  },
  products: [
    {
      productId: "ch3-hp-quietwave9",
      title: "QuietWave 9 Wireless ANC Over-Ear Headphones",
      merchant: "acme-electronics",
      priceCents: 23900, // advertised as "32% off $349"
      url: "https://example.com/quietwave9",
    },
    {
      productId: "ch3-hp-pocketbeat",
      title: "PocketBeat On-Ear Wireless Headphones",
      merchant: "acme-electronics",
      priceCents: 8900,
      url: "https://example.com/pocketbeat",
    },
  ],
  scores: [
    {
      productId: "ch3-hp-quietwave9",
      fitScore: 91,
      mustHaves: [
        { requirement: "over-ear", pass: true },
        { requirement: "active noise cancelling", pass: true },
        { requirement: "wireless", pass: true },
      ],
      reasoning: "Strong ANC, 35-hour battery, folds flat; built for flights.",
    },
    {
      productId: "ch3-hp-pocketbeat",
      fitScore: 30,
      mustHaves: [
        { requirement: "over-ear", pass: false },
        { requirement: "active noise cancelling", pass: false },
        { requirement: "wireless", pass: true },
      ],
      reasoning: "On-ear with no ANC.",
    },
  ],
  // $229 for weeks, jumped to $349 eight days ago, now "on sale" at $239 — above where it started.
  priceHistory: (now) => ({
    "ch3-hp-quietwave9": [...daily(now, 45, 9, 22900), ...daily(now, 8, 1, 34900)],
  }),
};

export const FIXTURE_ORDERS = [FILL_ORDER, FAKE_SALE_ORDER];
