// Step 4 — Guardrails (code only, no model). Never skippable.
// Can only make a decision more conservative: fill → ask → skip. Never upgrades.
import type { Action, Decision, OrderPolicy, ScoredCandidate } from "@/lib/schemas";
import { formatUsd } from "@/lib/money";

/**
 * What a kill-switch block is recorded as. The persisted watch loop (run-order.ts) stops a proposed purchase
 * before execute when the owner's kill switch is on, and writes the decision with these. applyGuardrails below
 * still downgrades a buy to skip on its own, so the switch holds even for callers that skip that check.
 */
export const KILL_SWITCH_REASON = "kill_switch";
export const KILL_SWITCH_REASONING = "Agent paused by kill switch — no purchase made";

export interface GuardrailInput {
  decision: Decision;
  candidate: ScoredCandidate | null;
  policy: OrderPolicy;
  killSwitch: boolean;
  /** Sum of captured fills for this user in the current calendar month. */
  monthToDateSpendCents: number;
}

export interface GuardrailResult {
  modelAction: Action;
  action: Action;
  /** Why the action was downgraded; empty when the model's action stands. */
  reasons: string[];
}

const SEVERITY: Record<Action, number> = { fill: 0, ask: 1, hold: 2, skip: 3 };

export function applyGuardrails(input: GuardrailInput): GuardrailResult {
  const { decision, candidate, policy } = input;
  const modelAction = decision.action;
  const reasons: string[] = [];
  let action: Action = modelAction;

  const downgrade = (to: Action, reason: string) => {
    if (SEVERITY[to] > SEVERITY[action]) action = to;
    reasons.push(reason);
  };

  // hold and skip spend nothing; only buying actions need checks.
  if (modelAction !== "fill" && modelAction !== "ask") {
    return { modelAction, action, reasons };
  }

  if (input.killSwitch) {
    downgrade("skip", "Kill switch is on: the agent may not buy anything.");
  }
  if (!candidate) {
    downgrade("skip", "No candidate passed scoring.");
    return { modelAction, action, reasons };
  }
  if (decision.productId !== candidate.productId) {
    downgrade("skip", `Decision referenced ${decision.productId ?? "no product"}, not the top candidate.`);
  }
  if (candidate.priceCents > policy.maxPriceCents) {
    downgrade(
      "skip",
      `Price ${formatUsd(candidate.priceCents)} exceeds the order's max ${formatUsd(policy.maxPriceCents)}.`,
    );
  }

  if (modelAction === "fill") {
    if (candidate.priceCents > policy.perOrderCapCents) {
      downgrade(
        "ask",
        `Price ${formatUsd(candidate.priceCents)} exceeds the per-order cap ${formatUsd(policy.perOrderCapCents)}.`,
      );
    }
    if (input.monthToDateSpendCents + candidate.priceCents > policy.monthlyCapCents) {
      downgrade(
        "ask",
        `Would bring this month's spend to ${formatUsd(input.monthToDateSpendCents + candidate.priceCents)}, over the ${formatUsd(policy.monthlyCapCents)} monthly cap.`,
      );
    }
    if (!policy.merchantAllowlist.includes(candidate.merchant)) {
      downgrade("ask", `Merchant ${candidate.merchant} is not on the allowlist.`);
    }
  }

  return { modelAction, action, reasons };
}
