// End-to-end steps 2 → 5 on the demo fixtures: one fill, one refusal.
import { describe, expect, it } from "vitest";
import { FAKE_SALE_ORDER, FILL_ORDER, FIXTURE_NOW, type FixtureOrder } from "@/fixtures/demo";
import { fixtureCycleDeps } from "@/fixtures/fakes";
import { SALE_EVENTS } from "../config";
import { runCycle } from "../run-cycle";
import { applyGuardrails } from "../steps/guardrails";

function cycle(order: FixtureOrder, overrides: { killSwitch?: boolean } = {}) {
  const { deps, paypal, notifier } = fixtureCycleDeps(order, FIXTURE_NOW);
  const result = runCycle(
    {
      orderId: order.id,
      userId: "user-1",
      spec: order.spec,
      policy: order.policy,
      killSwitch: overrides.killSwitch ?? false,
      monthToDateSpendCents: 0,
      saleEvents: SALE_EVENTS,
      appBaseUrl: "http://localhost:3000",
      now: FIXTURE_NOW,
    },
    deps,
  );
  return { result, paypal, notifier };
}

describe("refusal: fake sale", () => {
  it("skips, never touches PayPal, and explains why", async () => {
    const { result, paypal, notifier } = cycle(FAKE_SALE_ORDER);
    const r = await result;

    expect(r.search.candidates[0].productId).toBe("ch3-hp-quietwave9");
    expect(r.decide.priceSignals?.fakeSale.detected).toBe(true);
    expect(r.guardrails).toEqual({ modelAction: "skip", action: "skip", reasons: [] });
    expect(r.execution.kind).toBe("none");
    expect(paypal.calls).toEqual([]);

    expect(r.execution.explanation).toMatch(/^I passed on "QuietWave 9/);
    expect(r.execution.explanation).toMatch(/fake sale/i);
    expect(notifier.sent).toHaveLength(1);
    expect(r.llmCalls.map((c) => c.step)).toEqual(["search_and_score", "decide"]);
  });

  it("is refused by the decision, not by guardrails: caps and allowlist would have allowed a fill", async () => {
    const r = await cycle(FAKE_SALE_ORDER).result;
    const candidate = r.search.candidates[0];
    const ifModelSaidFill = applyGuardrails({
      decision: { action: "fill", productId: candidate.productId, reasoning: "" },
      candidate,
      policy: FAKE_SALE_ORDER.policy,
      killSwitch: false,
      monthToDateSpendCents: 0,
    });
    expect(ifModelSaidFill.action).toBe("fill");
  });
});

describe("fill: genuine drop at the sandbox store", () => {
  it("captures once via the vault (tier 1), keyed by the decision id", async () => {
    const { result, paypal } = cycle(FILL_ORDER);
    const r = await result;

    expect(r.guardrails.action).toBe("fill");
    expect(r.execution).toMatchObject({
      kind: "filled",
      tier: 1,
      fill: { merchant: "standing-orders-sandbox-store", amountCents: 24900, status: "captured" },
    });
    expect(paypal.calls).toHaveLength(1);
    expect(paypal.calls[0]).toMatchObject({
      method: "createAndCaptureWithVault",
      params: { amountCents: 24900, idempotencyKey: r.decisionId },
    });
  });

  it("kill switch stops it before PayPal", async () => {
    const { result, paypal } = cycle(FILL_ORDER, { killSwitch: true });
    const r = await result;

    expect(r.guardrails).toMatchObject({ modelAction: "fill", action: "skip" });
    expect(paypal.calls).toEqual([]);
    expect(r.execution.explanation).toMatch(/Kill switch/);
  });
});
