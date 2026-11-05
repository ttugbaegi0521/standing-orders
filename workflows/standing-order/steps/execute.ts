// Step 5 — Execute or notify (code only). The only step that touches PayPal.
// Returns what to persist; the caller writes `decisions`, `fills`, `approvals` rows.
// The caller must check for an existing `fills` row first — that row is the lock.
import type { Notifier } from "@/lib/notify";
import type { PayPalClient } from "@/lib/paypal";
import type { Action, ScoredCandidate } from "@/lib/schemas";
import { formatUsd } from "@/lib/money";
import { APPROVAL_TTL_HOURS, SANDBOX_STORE_MERCHANT } from "../config";

export interface ExecuteInput {
  orderId: string;
  userId: string;
  /** Pre-generated decisions.id; doubles as the PayPal idempotency key. */
  decisionId: string;
  /** Final action from guardrails. */
  action: Action;
  candidate: ScoredCandidate | null;
  reasoning: string;
  guardrailReasons: string[];
  appBaseUrl: string;
  /** ISO datetime. */
  now: string;
}

export interface ExecuteDeps {
  paypal: PayPalClient;
  notifier: Notifier;
  newApprovalToken: () => string;
}

export type ExecuteOutput =
  | {
      kind: "filled";
      tier: 1;
      fill: {
        paypalOrderId: string;
        merchant: string;
        amountCents: number;
        status: "captured" | "failed";
      };
      explanation: string;
    }
  | {
      kind: "approval_requested";
      tier: 2;
      approval: { token: string; paypalOrderId: string; expiresAt: string };
      explanation: string;
    }
  | { kind: "none"; explanation: string };

export function isTier1(merchant: string): boolean {
  return merchant === SANDBOX_STORE_MERCHANT;
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

export async function executeOrNotify(
  input: ExecuteInput,
  deps: ExecuteDeps,
): Promise<ExecuteOutput> {
  const { candidate } = input;
  const notify = (explanation: string, link?: string) =>
    deps.notifier.send({
      userId: input.userId,
      subject: `Standing order: ${input.action}`,
      body: explanation,
      link,
    });

  if (!candidate || input.action === "hold" || input.action === "skip") {
    const explanation = explain(input);
    await notify(explanation);
    return { kind: "none", explanation };
  }

  const params = {
    amountCents: candidate.priceCents,
    merchant: candidate.merchant,
    description: candidate.title,
    idempotencyKey: input.decisionId,
  };

  // Tier 1: model said fill, guardrails agreed, and the merchant supports agent checkout.
  if (input.action === "fill" && isTier1(candidate.merchant)) {
    const { paypalOrderId, status } = await deps.paypal.createAndCaptureWithVault({
      ...params,
      userId: input.userId,
    });
    const explanation = explain(input);
    await notify(explanation);
    return {
      kind: "filled",
      tier: 1,
      fill: { paypalOrderId, merchant: candidate.merchant, amountCents: candidate.priceCents, status },
      explanation,
    };
  }

  // Tier 2: any other merchant, or anything that needs a human (ask). Worded as "ask"
  // even when the model said fill, because nothing is bought until the user approves.
  const { paypalOrderId } = await deps.paypal.createOrder(params);
  const token = deps.newApprovalToken();
  const expiresAt = new Date(Date.parse(input.now) + APPROVAL_TTL_HOURS * 3600_000).toISOString();
  const explanation = explain({ ...input, action: "ask" });
  await notify(explanation, `${input.appBaseUrl}/approvals/${token}`);
  return {
    kind: "approval_requested",
    tier: 2,
    approval: { token, paypalOrderId, expiresAt },
    explanation,
  };
}
