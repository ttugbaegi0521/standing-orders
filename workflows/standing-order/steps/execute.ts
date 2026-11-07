// Step 5 — Execute or notify (code only). The only step that touches PayPal.
//
// With `deps.persistence` it also owns the writes that make it safe to retry: the `decisions` audit row
// first, then a `fills` row keyed by decision_id (the lock) before PayPal is called. Without it the step
// is pure and the caller persists, as run-cycle's fixture tests do.
import { getPool } from "@/lib/db";
import { formatUsd } from "@/lib/money";
import type { Notifier } from "@/lib/notify";
import type { PayPalClient } from "@/lib/paypal";
import type { Action, ScoredCandidate } from "@/lib/schemas";
import { APPROVAL_TTL_HOURS } from "../config";
import type { PriceSignals } from "../price-signals";

export interface ExecuteInput {
  orderId: string;
  userId: string;
  /** Pre-generated decisions.id; doubles as the PayPal idempotency key and the fills lock. */
  decisionId: string;
  /** Final action from guardrails. */
  action: Action;
  /** The model's action before guardrails, for the audit row. Defaults to `action`. */
  modelAction?: Action;
  candidate: ScoredCandidate | null;
  reasoning: string;
  guardrailReasons: string[];
  /** Step 3's price analysis for the candidate; used by the DEMO_SAFETY check. */
  priceSignals?: PriceSignals | null;
  llmInputHash?: string | null;
  appBaseUrl: string;
  /** ISO datetime. */
  now: string;
}

export type FillStatus = "pending" | "captured" | "failed" | "refunded";

export interface FillRow {
  decisionId: string;
  paypalOrderId: string | null;
  captureId: string | null;
  merchant: string;
  amountCents: number;
  status: FillStatus;
  error: string | null;
}

export interface ApprovalRow {
  token: string;
  paypalOrderId: string | null;
  expiresAt: string;
}

export interface DecisionRow {
  id: string;
  orderId: string;
  modelAction: Action;
  action: Action;
  reasoning: string;
  guardrailReasons: string[];
  explanation: string | null;
  llmInputHash: string | null;
}

/** The writes step 5 makes. Postgres in production, in-memory in tests. */
export interface ExecutePersistence {
  /** Upsert by id; a second call only updates the explanation. */
  recordDecision(row: DecisionRow): Promise<void>;
  /** INSERT … ON CONFLICT (decision_id) DO NOTHING; `inserted` false means a prior attempt owns it. */
  insertPendingFill(row: {
    orderId: string;
    decisionId: string;
    merchant: string;
    amountCents: number;
  }): Promise<{ inserted: boolean; fill: FillRow }>;
  updateFill(
    decisionId: string,
    patch: Partial<Pick<FillRow, "paypalOrderId" | "captureId" | "status" | "error">>,
  ): Promise<void>;
  insertApproval(row: { decisionId: string; token: string; paypalOrderId: string; expiresAt: string }): Promise<void>;
  findApproval(decisionId: string): Promise<ApprovalRow | null>;
}

export interface ExecuteDeps {
  paypal: PayPalClient;
  notifier: Notifier;
  newApprovalToken: () => string;
  persistence?: ExecutePersistence;
}

export type ExecuteOutput =
  | {
      kind: "filled";
      tier: 1;
      fill: {
        paypalOrderId: string | null;
        captureId?: string | null;
        merchant: string;
        amountCents: number;
        status: FillStatus;
      };
      /** True when a previous attempt for this decision already owned the fill; PayPal was not called. */
      replayed?: boolean;
      explanation: string;
    }
  | {
      kind: "approval_requested";
      tier: 2;
      approval: { token: string; paypalOrderId: string; expiresAt: string };
      replayed?: boolean;
      explanation: string;
    }
  | { kind: "refused"; guardrailReasons: string[]; explanation: string }
  | { kind: "error"; error: { code: "paypal_failed" | "persistence_failed"; message: string }; explanation: string }
  | { kind: "none"; explanation: string };

/** Tier 1 = the merchant supports agent checkout, per AGENT_READY_MERCHANTS (comma-separated). */
export function isTier1(merchant: string): boolean {
  const ready = (process.env.AGENT_READY_MERCHANTS ?? "")
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
  return ready.includes(merchant.trim().toLowerCase());
}

function firstSentence(text: string): string {
  const match = text.trim().match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim();
}

/** Two sentences, shown to the user and stored on the decision. */
export function explain(input: Pick<ExecuteInput, "action" | "candidate" | "reasoning" | "guardrailReasons">): string {
  const { action, candidate, reasoning, guardrailReasons } = input;
  const why = firstSentence(guardrailReasons[0] ?? reasoning);
  if (!candidate) return `Nothing matched your order yet, so I'm still watching. ${why}`;
  const item = `"${candidate.title}" from ${candidate.merchant} at ${formatUsd(candidate.priceCents)}`;
  switch (action) {
    case "fill":
      return `I bought ${item}. ${why}`;
    case "ask":
      return `I found ${item} but need your OK before buying. ${why}`;
    case "hold":
      return `I'm holding off on ${item} for now. ${why}`;
    case "skip":
      return `I passed on ${item}. ${why}`;
  }
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}

export async function executeOrNotify(
  input: ExecuteInput,
  deps: ExecuteDeps,
): Promise<ExecuteOutput> {
  const { candidate } = input;
  const { persistence } = deps;
  const notify = (explanation: string, link?: string) =>
    deps.notifier.send({
      userId: input.userId,
      subject: `Standing order: ${input.action}`,
      body: explanation,
      link,
    });
  const decisionRow = (over: Partial<DecisionRow> = {}): DecisionRow => ({
    id: input.decisionId,
    orderId: input.orderId,
    modelAction: input.modelAction ?? input.action,
    action: input.action,
    reasoning: input.reasoning,
    guardrailReasons: input.guardrailReasons,
    explanation: null,
    llmInputHash: input.llmInputHash ?? null,
    ...over,
  });
  /** Audit-row writes after PayPal has acted must not turn a done deal into a crash. */
  const recordExplanation = async (explanation: string) => {
    try {
      await persistence?.recordDecision(decisionRow({ explanation }));
    } catch (err) {
      console.error(`[execute] could not store explanation for decision ${input.decisionId}: ${errorMessage(err)}`);
    }
  };
  const settleFill = async (patch: Parameters<ExecutePersistence["updateFill"]>[1]) => {
    try {
      await persistence?.updateFill(input.decisionId, patch);
    } catch (err) {
      console.error(`[execute] could not update fill for decision ${input.decisionId}: ${errorMessage(err)}`);
    }
  };

  // DEMO_SAFETY: never spend (or ask the user to spend) on something step 3's analysis calls a fake sale.
  if (
    process.env.DEMO_SAFETY === "true" &&
    candidate &&
    (input.action === "fill" || input.action === "ask") &&
    input.priceSignals?.fakeSale.detected
  ) {
    const guardrailReasons = ["demo_safety_fake_sale_block"];
    const explanation = `I passed on "${candidate.title}" from ${candidate.merchant} at ${formatUsd(candidate.priceCents)}. Demo safety is on and its price history looks like a fake sale.`;
    try {
      await persistence?.recordDecision(
        decisionRow({ action: "skip", guardrailReasons: [...input.guardrailReasons, ...guardrailReasons], explanation }),
      );
    } catch (err) {
      console.error(`[execute] could not record refusal for decision ${input.decisionId}: ${errorMessage(err)}`);
    }
    await notify(explanation);
    return { kind: "refused", guardrailReasons, explanation };
  }

  if (!candidate || input.action === "hold" || input.action === "skip") {
    const explanation = explain(input);
    try {
      await persistence?.recordDecision(decisionRow({ explanation }));
    } catch (err) {
      console.error(`[execute] could not record decision ${input.decisionId}: ${errorMessage(err)}`);
    }
    await notify(explanation);
    return { kind: "none", explanation };
  }

  const params = {
    amountCents: candidate.priceCents,
    merchant: candidate.merchant,
    description: candidate.title,
    idempotencyKey: input.decisionId,
  };
  const tier1 = input.action === "fill" && isTier1(candidate.merchant);

  // The decision row has to exist before the fill row: fills.decision_id references it.
  if (persistence) {
    try {
      await persistence.recordDecision(decisionRow());
    } catch (err) {
      const message = errorMessage(err);
      return {
        kind: "error",
        error: { code: "persistence_failed", message },
        explanation: `I couldn't record this decision, so I did not buy anything. ${message}`,
      };
    }
  }

  // Take the lock. If a previous attempt for this decision already did, hand back what it left behind.
  let existing: FillRow | null = null;
  if (persistence) {
    try {
      const { inserted, fill } = await persistence.insertPendingFill({
        orderId: input.orderId,
        decisionId: input.decisionId,
        merchant: candidate.merchant,
        amountCents: candidate.priceCents,
      });
      if (!inserted) existing = fill;
    } catch (err) {
      const message = errorMessage(err);
      return {
        kind: "error",
        error: { code: "persistence_failed", message },
        explanation: `I couldn't reserve this purchase, so I did not buy anything. ${message}`,
      };
    }
  }

  if (existing) {
    const explanation = explain(input);
    if (tier1) {
      return {
        kind: "filled",
        tier: 1,
        fill: {
          paypalOrderId: existing.paypalOrderId,
          captureId: existing.captureId,
          merchant: existing.merchant,
          amountCents: existing.amountCents,
          status: existing.status,
        },
        replayed: true,
        explanation,
      };
    }
    const approval = await persistence!.findApproval(input.decisionId);
    if (approval && existing.paypalOrderId) {
      return {
        kind: "approval_requested",
        tier: 2,
        approval: { token: approval.token, paypalOrderId: existing.paypalOrderId, expiresAt: approval.expiresAt },
        replayed: true,
        explanation: explain({ ...input, action: "ask" }),
      };
    }
    return {
      kind: "error",
      error: { code: "paypal_failed", message: existing.error ?? "a previous attempt for this decision did not complete" },
      explanation: `An earlier attempt for this decision did not complete, so I did not retry it.`,
    };
  }

  // Tier 1: model said fill, guardrails agreed, and the merchant supports agent checkout.
  if (tier1) {
    let result;
    try {
      result = await deps.paypal.createAndCaptureWithVault({ ...params, userId: input.userId });
    } catch (err) {
      const message = errorMessage(err);
      await settleFill({ status: "failed", error: message });
      const explanation = `I tried to buy "${candidate.title}" from ${candidate.merchant} at ${formatUsd(candidate.priceCents)} but PayPal did not complete it, so you were not charged. ${message}`;
      await recordExplanation(explanation);
      await notify(explanation);
      return { kind: "error", error: { code: "paypal_failed", message }, explanation };
    }

    const status: FillStatus = result.status;
    await settleFill({
      paypalOrderId: result.paypalOrderId,
      captureId: result.captureId ?? null,
      status,
      error: status === "failed" ? "PayPal declined the capture" : null,
    });
    const explanation =
      status === "failed"
        ? `I tried to buy "${candidate.title}" from ${candidate.merchant} at ${formatUsd(candidate.priceCents)} but PayPal declined the payment. You were not charged.`
        : explain(input);
    await recordExplanation(explanation);
    await notify(explanation);
    return {
      kind: "filled",
      tier: 1,
      fill: {
        paypalOrderId: result.paypalOrderId,
        captureId: result.captureId ?? null,
        merchant: candidate.merchant,
        amountCents: candidate.priceCents,
        status,
      },
      explanation,
    };
  }

  // Tier 2: any other merchant, or anything that needs a human (ask). Worded as "ask"
  // even when the model said fill, because nothing is bought until the user approves.
  const token = deps.newApprovalToken();
  const expiresAt = new Date(Date.parse(input.now) + APPROVAL_TTL_HOURS * 3600_000).toISOString();
  let created;
  try {
    created = await deps.paypal.createOrder({
      ...params,
      returnUrl: `${input.appBaseUrl}/approvals/${token}`,
      cancelUrl: `${input.appBaseUrl}/approvals/${token}?cancelled=1`,
    });
  } catch (err) {
    const message = errorMessage(err);
    await settleFill({ status: "failed", error: message });
    const explanation = `I found "${candidate.title}" from ${candidate.merchant} at ${formatUsd(candidate.priceCents)} but couldn't set up the PayPal order for your approval. ${message}`;
    await recordExplanation(explanation);
    await notify(explanation);
    return { kind: "error", error: { code: "paypal_failed", message }, explanation };
  }

  await settleFill({ paypalOrderId: created.paypalOrderId });
  if (persistence) {
    try {
      await persistence.insertApproval({
        decisionId: input.decisionId,
        token,
        paypalOrderId: created.paypalOrderId,
        expiresAt,
      });
    } catch (err) {
      const message = errorMessage(err);
      await settleFill({ status: "failed", error: message });
      return {
        kind: "error",
        error: { code: "persistence_failed", message },
        explanation: `I couldn't save the approval for this purchase, so nothing was bought. ${message}`,
      };
    }
  }
  const explanation = explain({ ...input, action: "ask" });
  await recordExplanation(explanation);
  // The user approves on PayPal first; PayPal then returns them to /approvals/<token>, which POSTs the capture.
  await notify(explanation, created.approveUrl);
  return {
    kind: "approval_requested",
    tier: 2,
    approval: { token, paypalOrderId: created.paypalOrderId, expiresAt },
    explanation,
  };
}

// ---- Postgres persistence ----

interface FillDbRow {
  decision_id: string;
  paypal_order_id: string | null;
  capture_id: string | null;
  merchant: string;
  amount_cents: number;
  status: FillStatus;
  error: string | null;
}

function toFillRow(r: FillDbRow): FillRow {
  return {
    decisionId: r.decision_id,
    paypalOrderId: r.paypal_order_id,
    captureId: r.capture_id,
    merchant: r.merchant,
    amountCents: r.amount_cents,
    status: r.status,
    error: r.error,
  };
}

export function createPgExecutePersistence(): ExecutePersistence {
  const db = () => getPool();
  return {
    async recordDecision(row) {
      await db().query(
        `INSERT INTO decisions
           (id, order_id, model_action, action, reasoning, guardrail_reasons, explanation, llm_input_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           action = EXCLUDED.action,
           guardrail_reasons = EXCLUDED.guardrail_reasons,
           explanation = COALESCE(EXCLUDED.explanation, decisions.explanation)`,
        [
          row.id,
          row.orderId,
          row.modelAction,
          row.action,
          row.reasoning,
          row.guardrailReasons,
          row.explanation,
          row.llmInputHash,
        ],
      );
    },

    async insertPendingFill({ orderId, decisionId, merchant, amountCents }) {
      const inserted = await db().query<FillDbRow>(
        `INSERT INTO fills (order_id, decision_id, merchant, amount_cents, status)
         VALUES ($1, $2, $3, $4, 'pending')
         ON CONFLICT (decision_id) DO NOTHING
         RETURNING *`,
        [orderId, decisionId, merchant, amountCents],
      );
      if (inserted.rows[0]) return { inserted: true, fill: toFillRow(inserted.rows[0]) };
      const { rows } = await db().query<FillDbRow>("SELECT * FROM fills WHERE decision_id = $1", [decisionId]);
      return { inserted: false, fill: toFillRow(rows[0]) };
    },

    async updateFill(decisionId, patch) {
      await db().query(
        `UPDATE fills SET
           paypal_order_id = COALESCE($2, paypal_order_id),
           capture_id = COALESCE($3, capture_id),
           status = COALESCE($4, status),
           error = $5,
           updated_at = now()
         WHERE decision_id = $1`,
        [decisionId, patch.paypalOrderId ?? null, patch.captureId ?? null, patch.status ?? null, patch.error ?? null],
      );
    },

    async insertApproval({ decisionId, token, paypalOrderId, expiresAt }) {
      await db().query(
        "INSERT INTO approvals (decision_id, token, paypal_order_id, expires_at) VALUES ($1, $2, $3, $4)",
        [decisionId, token, paypalOrderId, expiresAt],
      );
    },

    async findApproval(decisionId) {
      const { rows } = await db().query<{ token: string; paypal_order_id: string | null; expires_at: Date }>(
        "SELECT token, paypal_order_id, expires_at FROM approvals WHERE decision_id = $1",
        [decisionId],
      );
      const r = rows[0];
      return r ? { token: r.token, paypalOrderId: r.paypal_order_id, expiresAt: r.expires_at.toISOString() } : null;
    },
  };
}
