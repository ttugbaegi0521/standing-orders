// Step 5 against in-memory persistence and the recording PayPal fake. No network, no database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_SALE_ORDER, FILL_ORDER, FIXTURE_NOW } from "@/fixtures/demo";
import { recordingNotifier, recordingPayPal } from "@/fixtures/fakes";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { PayPalClient } from "@/lib/paypal";
import type { ScoredCandidate } from "@/lib/schemas";
import { analyzePriceHistory } from "../price-signals";
import {
  executeOrNotify,
  type ApprovalRow,
  type DecisionRow,
  type ExecuteInput,
  type ExecutePersistence,
  type FillRow,
} from "../steps/execute";

function memoryPersistence() {
  const decisions = new Map<string, DecisionRow>();
  const fills = new Map<string, FillRow>();
  const approvals = new Map<string, ApprovalRow>();
  const persistence: ExecutePersistence = {
    async recordDecision(row) {
      const prior = decisions.get(row.id);
      decisions.set(row.id, prior ? { ...prior, explanation: row.explanation ?? prior.explanation } : row);
    },
    async insertPendingFill({ decisionId, merchant, amountCents }) {
      const existing = fills.get(decisionId);
      if (existing) return { inserted: false, fill: existing };
      const fill: FillRow = {
        decisionId,
        paypalOrderId: null,
        captureId: null,
        merchant,
        amountCents,
        status: "pending",
        error: null,
      };
      fills.set(decisionId, fill);
      return { inserted: true, fill };
    },
    async updateFill(decisionId, patch) {
      const fill = fills.get(decisionId)!;
      fills.set(decisionId, {
        ...fill,
        paypalOrderId: patch.paypalOrderId ?? fill.paypalOrderId,
        captureId: patch.captureId ?? fill.captureId,
        status: patch.status ?? fill.status,
        error: patch.error ?? null,
      });
    },
    async insertApproval({ decisionId, token, paypalOrderId, expiresAt }) {
      approvals.set(decisionId, { token, paypalOrderId, expiresAt });
    },
    async findApproval(decisionId) {
      return approvals.get(decisionId) ?? null;
    },
  };
  return { persistence, decisions, fills, approvals };
}

const sandboxCandidate: ScoredCandidate = {
  ...FILL_ORDER.products[0],
  fitScore: 95,
  mustHaves: [],
  reasoning: "Fits.",
};
const otherCandidate: ScoredCandidate = { ...sandboxCandidate, productId: "ch3-x", merchant: "acme-electronics" };

function input(over: Partial<ExecuteInput> = {}): ExecuteInput {
  return {
    orderId: FILL_ORDER.id,
    userId: "user-1",
    decisionId: "decision-1",
    action: "fill",
    candidate: sandboxCandidate,
    reasoning: "Genuine drop.",
    guardrailReasons: [],
    appBaseUrl: "http://localhost:3000",
    now: FIXTURE_NOW,
    ...over,
  };
}

function setup(paypalOverrides: Partial<PayPalClient> = {}) {
  const paypal = recordingPayPal();
  const notifier = recordingNotifier();
  const store = memoryPersistence();
  const deps = {
    paypal: { ...paypal, ...paypalOverrides } as PayPalClient,
    notifier,
    newApprovalToken: () => "tok-1",
    persistence: store.persistence,
  };
  return { paypal, notifier, store, deps };
}

describe("tier 1", () => {
  it("takes the lock, captures via the vault, and records fill + decision", async () => {
    const { paypal, store, deps } = setup();
    deps.paypal.createAndCaptureWithVault = async (p) => {
      paypal.calls.push({ method: "createAndCaptureWithVault", params: p });
      return { paypalOrderId: "PP-1", status: "captured", captureId: "CAP-1" };
    };
    const out = await executeOrNotify(input(), deps);

    expect(out).toMatchObject({
      kind: "filled",
      tier: 1,
      fill: { paypalOrderId: "PP-1", captureId: "CAP-1", status: "captured", amountCents: 24900 },
    });
    expect(paypal.calls).toHaveLength(1);
    expect(paypal.calls[0]).toMatchObject({ params: { userId: "user-1", idempotencyKey: "decision-1" } });
    expect(store.fills.get("decision-1")).toMatchObject({
      status: "captured",
      captureId: "CAP-1",
      paypalOrderId: "PP-1",
    });
    expect(store.decisions.get("decision-1")).toMatchObject({ action: "fill", modelAction: "fill" });
    expect(store.decisions.get("decision-1")?.explanation).toMatch(/^I bought/);
  });

  it("retry with the same decision returns the existing fill and never calls PayPal again", async () => {
    const { paypal, deps } = setup();
    const first = await executeOrNotify(input(), deps);
    const second = await executeOrNotify(input(), deps);

    expect(paypal.calls).toHaveLength(1);
    expect(first).toMatchObject({ kind: "filled", fill: { status: "captured" } });
    expect(second).toMatchObject({ kind: "filled", replayed: true, fill: { status: "captured" } });
  });

  it("is decided by AGENT_READY_MERCHANTS, not a hardcoded name", async () => {
    const { paypal, deps } = setup();
    vi.stubEnv("AGENT_READY_MERCHANTS", "acme-electronics, other");
    try {
      const out = await executeOrNotify(input({ candidate: otherCandidate }), deps);
      expect(out.kind).toBe("filled");
      expect(paypal.calls[0].method).toBe("createAndCaptureWithVault");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("tier 2", () => {
  it("creates an un-captured order, stores the approval and notifies; approving later captures", async () => {
    const { paypal, notifier, store, deps } = setup();
    const out = await executeOrNotify(input({ candidate: otherCandidate }), deps);

    expect(out).toMatchObject({
      kind: "approval_requested",
      tier: 2,
      approval: { token: "tok-1", paypalOrderId: "SANDBOX-decision-1" },
    });
    expect(paypal.calls.map((c) => c.method)).toEqual(["createOrder"]);
    expect(store.fills.get("decision-1")).toMatchObject({ status: "pending", paypalOrderId: "SANDBOX-decision-1" });
    expect(store.approvals.get("decision-1")?.token).toBe("tok-1");
    expect(notifier.sent[0].link).toContain("checkoutnow");

    // POST /api/approvals/:token calls captureOrder, then marks the fill captured.
    const captured = await deps.paypal.captureOrder("SANDBOX-decision-1");
    await store.persistence.updateFill("decision-1", { status: captured.status, captureId: "CAP-2" });
    expect(store.fills.get("decision-1")).toMatchObject({ status: "captured", captureId: "CAP-2" });
  });

  it("retry returns the same approval without creating a second PayPal order", async () => {
    const { paypal, deps } = setup();
    await executeOrNotify(input({ candidate: otherCandidate }), deps);
    const again = await executeOrNotify(input({ candidate: otherCandidate }), deps);
    expect(again).toMatchObject({ kind: "approval_requested", replayed: true, approval: { token: "tok-1" } });
    expect(paypal.calls).toHaveLength(1);
  });
});

describe("PayPal failure", () => {
  it("tier 1: marks the fill failed with the error, returns a typed error, does not throw", async () => {
    const { store, deps } = setup();
    deps.paypal.createAndCaptureWithVault = async () => {
      throw new Error("PayPal POST /v2/checkout/orders failed (422): INSTRUMENT_DECLINED");
    };
    const out = await executeOrNotify(input(), deps);

    expect(out).toMatchObject({ kind: "error", error: { code: "paypal_failed" } });
    expect(store.fills.get("decision-1")).toMatchObject({ status: "failed" });
    expect(store.fills.get("decision-1")?.error).toMatch(/INSTRUMENT_DECLINED/);
  });

  it("tier 2: a failed order creation is recorded the same way", async () => {
    const { store, deps } = setup();
    deps.paypal.createOrder = async () => {
      throw new Error("boom");
    };
    const out = await executeOrNotify(input({ candidate: otherCandidate }), deps);
    expect(out).toMatchObject({ kind: "error", error: { code: "paypal_failed", message: "boom" } });
    expect(store.fills.get("decision-1")).toMatchObject({ status: "failed", error: "boom" });
    expect(store.approvals.size).toBe(0);
  });
});

describe("DEMO_SAFETY", () => {
  const fakeSaleSignals = analyzePriceHistory(
    FAKE_SALE_ORDER.priceHistory(FIXTURE_NOW)[FAKE_SALE_ORDER.products[0].productId] ?? [],
    FAKE_SALE_ORDER.products[0].priceCents,
    FIXTURE_NOW,
  );

  beforeEach(() => vi.stubEnv("DEMO_SAFETY", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("refuses a fill whose price signals say fake sale, before PayPal or the lock", async () => {
    expect(fakeSaleSignals.fakeSale.detected).toBe(true);
    const { paypal, store, deps } = setup();
    const out = await executeOrNotify(input({ priceSignals: fakeSaleSignals }), deps);

    expect(out).toMatchObject({ kind: "refused", guardrailReasons: ["demo_safety_fake_sale_block"] });
    expect(paypal.calls).toEqual([]);
    expect(store.fills.size).toBe(0);
    expect(store.decisions.get("decision-1")).toMatchObject({ action: "skip" });
  });

  it("does nothing when the flag is off", async () => {
    vi.stubEnv("DEMO_SAFETY", "false");
    const { deps } = setup();
    const out = await executeOrNotify(input({ priceSignals: fakeSaleSignals }), deps);
    expect(out.kind).toBe("filled");
  });
});

describe("vault encryption", () => {
  beforeEach(() => vi.stubEnv("VAULT_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64")));
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips and does not leak plaintext", () => {
    const blob = encryptSecret("PAYMENT-TOKEN-123");
    expect(blob).not.toContain("PAYMENT-TOKEN-123");
    expect(decryptSecret(blob)).toBe("PAYMENT-TOKEN-123");
  });

  it("rejects tampering and a wrong-length key", () => {
    const parts = encryptSecret("x").split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
    vi.stubEnv("VAULT_ENCRYPTION_KEY", "short");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});
