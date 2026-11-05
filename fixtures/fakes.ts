// In-memory stand-ins for every external dependency. No network.
import type { Channel3Client, Channel3SearchParams } from "@/lib/channel3";
import type { Notification, Notifier } from "@/lib/notify";
import type { PayPalClient, PayPalOrderParams } from "@/lib/paypal";
import type { CandidateScore, Decision, PricePoint, Product } from "@/lib/schemas";
import type { DecideModelInput } from "@/workflows/standing-order/steps/decide";
import type { ParseIntentInput } from "@/workflows/standing-order/steps/parse-intent";
import type { ScoreModelInput } from "@/workflows/standing-order/steps/search-and-score";
import type { CycleDeps } from "@/workflows/standing-order/run-cycle";
import type { Model } from "@/workflows/standing-order/types";
import { FIXTURE_ORDERS, type FixtureOrder } from "./demo";

export function fixtureChannel3(products: Product[]): Channel3Client & { calls: Channel3SearchParams[] } {
  const calls: Channel3SearchParams[] = [];
  return {
    calls,
    async search(params) {
      calls.push(params);
      return products.slice(0, params.limit ?? products.length);
    },
  };
}

export const fixtureParseIntentModel: Model<ParseIntentInput> = {
  name: "fixture:parse-intent",
  async call({ rawIntent }) {
    const order = FIXTURE_ORDERS.find((o) => o.rawIntent === rawIntent);
    if (!order) throw new Error(`no fixture spec for intent: ${rawIntent}`);
    return order.spec;
  },
};

export function fixtureScoreModel(scores: CandidateScore[]): Model<ScoreModelInput> {
  return {
    name: "fixture:score",
    async call({ products }) {
      const ids = new Set(products.map((p) => p.productId));
      return { scores: scores.filter((s) => ids.has(s.productId)) };
    },
  };
}

/**
 * Deterministic stand-in for the step-3 LLM, using only what the model would see.
 * Also the reference behaviour the real prompt should reproduce on these fixtures.
 */
export const rulesDecideModel: Model<DecideModelInput> = {
  name: "fixture:rules-decide",
  async call({ candidate, priceSignals, upcomingSaleEvents, policy }): Promise<Decision> {
    if (!candidate || !priceSignals) {
      return { action: "hold", productId: null, reasoning: "No candidate meets the spec yet; keep watching." };
    }
    const productId = candidate.productId;
    const { fakeSale, baselineCents, pctVsBaseline } = priceSignals;

    if (fakeSale.detected) {
      const pct = Math.round((fakeSale.claimedDiscountPct ?? 0) * 100);
      return {
        action: "skip",
        productId,
        reasoning:
          `Fake sale: the price was raised to $${(fakeSale.inflatedPeakCents! / 100).toFixed(2)} on ` +
          `${fakeSale.inflatedAt!.slice(0, 10)}, so the advertised ${pct}% discount is not real. ` +
          `It sold for $${(baselineCents! / 100).toFixed(2)} before that, which is less than today's price.`,
      };
    }

    const nextSale = upcomingSaleEvents.find((e) => e.daysAway <= 30);
    if (nextSale && (pctVsBaseline === null || pctVsBaseline > -0.1)) {
      return {
        action: "hold",
        productId,
        reasoning: `${nextSale.name} is ${nextSale.daysAway} days away and today's price is not a meaningful drop.`,
      };
    }

    if (
      candidate.priceCents > policy.perOrderCapCents ||
      !policy.merchantAllowlist.includes(candidate.merchant)
    ) {
      return { action: "ask", productId, reasoning: "Good fit, but it is outside your caps or allowlist." };
    }

    return {
      action: "fill",
      productId,
      reasoning: `Fits every must-have and is ${Math.round(-(pctVsBaseline ?? 0) * 100)}% below its usual price.`,
    };
  },
};

export function recordingPayPal(): PayPalClient & {
  calls: { method: keyof PayPalClient; params: PayPalOrderParams | string }[];
} {
  const calls: { method: keyof PayPalClient; params: PayPalOrderParams | string }[] = [];
  return {
    calls,
    async createAndCaptureWithVault(params) {
      calls.push({ method: "createAndCaptureWithVault", params });
      return { paypalOrderId: `SANDBOX-${params.idempotencyKey}`, status: "captured" };
    },
    async createOrder(params) {
      calls.push({ method: "createOrder", params });
      const paypalOrderId = `SANDBOX-${params.idempotencyKey}`;
      return { paypalOrderId, approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${paypalOrderId}` };
    },
    async captureOrder(paypalOrderId) {
      calls.push({ method: "captureOrder", params: paypalOrderId });
      return { status: "captured" };
    },
  };
}

export function recordingNotifier(): Notifier & { sent: Notification[] } {
  const sent: Notification[] = [];
  return {
    sent,
    async send(n) {
      sent.push(n);
    },
  };
}

/** Everything runCycle needs for one fixture order, with recorders exposed for assertions. */
export function fixtureCycleDeps(order: FixtureOrder, now: string) {
  const history = order.priceHistory(now);
  const paypal = recordingPayPal();
  const notifier = recordingNotifier();
  let n = 0;
  const deps: CycleDeps = {
    channel3: fixtureChannel3(order.products),
    scoreModel: fixtureScoreModel(order.scores),
    decideModel: rulesDecideModel,
    getPriceHistory: async (productId): Promise<PricePoint[]> => history[productId] ?? [],
    paypal,
    notifier,
    newId: () => `decision-${++n}`,
    newApprovalToken: () => `token-${n}`,
  };
  return { deps, paypal, notifier };
}
