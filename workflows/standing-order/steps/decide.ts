// Step 3 — Decide (LLM): fill | hold | ask | skip for the top candidate.
// Price signals (incl. fake-sale detection) are computed in code and given to the model.
import {
  DecisionSchema,
  type Decision,
  type OrderPolicy,
  type PricePoint,
  type SaleEvent,
  type ScoredCandidate,
  type Spec,
} from "@/lib/schemas";
import { callModel } from "../call-model";
import { analyzePriceHistory, type PriceSignals } from "../price-signals";
import type { Model, StepResult } from "../types";

export interface DecideInput {
  spec: Spec;
  /** Top candidate from step 2, or null if nothing passed. */
  candidate: ScoredCandidate | null;
  /** Price history for `candidate` (excluding the current observation). */
  priceHistory: PricePoint[];
  /** ISO datetime. */
  now: string;
  saleEvents: SaleEvent[];
  policy: OrderPolicy;
}

/** Exactly what the model sees. Keep secrets (vault tokens, emails) out of this. */
export interface DecideModelInput {
  spec: Spec;
  candidate: ScoredCandidate | null;
  priceSignals: PriceSignals | null;
  today: string;
  upcomingSaleEvents: (SaleEvent & { daysAway: number })[];
  policy: OrderPolicy;
}

export interface DecideDeps {
  model: Model<DecideModelInput>;
}

export interface DecideOutput {
  decision: Decision;
  priceSignals: PriceSignals | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildDecideModelInput(input: DecideInput): DecideModelInput {
  const now = Date.parse(input.now);
  const today = input.now.slice(0, 10);
  return {
    spec: input.spec,
    candidate: input.candidate,
    priceSignals: input.candidate
      ? analyzePriceHistory(input.priceHistory, input.candidate.priceCents, input.now)
      : null,
    today,
    upcomingSaleEvents: input.saleEvents
      .map((e) => ({ ...e, daysAway: Math.ceil((Date.parse(e.date) - now) / DAY_MS) }))
      .filter((e) => e.daysAway >= 0),
    policy: input.policy,
  };
}

export async function decide(
  input: DecideInput,
  deps: DecideDeps,
): Promise<StepResult<DecideOutput>> {
  const modelInput = buildDecideModelInput(input);
  // TODO(Sat): real model = Claude via AI SDK generateObject with DecisionSchema.
  const { output: decision, llmCall } = await callModel(
    "decide",
    deps.model,
    modelInput,
    DecisionSchema,
  );
  return { output: { decision, priceSignals: modelInput.priceSignals }, llmCall };
}
