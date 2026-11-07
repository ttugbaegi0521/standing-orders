// One watch cycle for an active standing order: steps 2 → 5, no persistence.
// The Render Workflow (TODO Sun) wraps this, persists the result, and on `hold` sleeps and re-runs.
import type { Channel3Client } from "@/lib/channel3";
import type { Notifier } from "@/lib/notify";
import type { PayPalClient } from "@/lib/paypal";
import type { OrderPolicy, PricePoint, SaleEvent, Spec } from "@/lib/schemas";
import { decide, type DecideModelInput, type DecideOutput } from "./steps/decide";
import { executeOrNotify, type ExecuteOutput } from "./steps/execute";
import { applyGuardrails, type GuardrailResult } from "./steps/guardrails";
import {
  searchAndScore,
  type ScoreModelInput,
  type SearchAndScoreOutput,
} from "./steps/search-and-score";
import type { LlmCallRecord, Model } from "./types";

export interface CycleInput {
  orderId: string;
  userId: string;
  spec: Spec;
  policy: OrderPolicy;
  killSwitch: boolean;
  monthToDateSpendCents: number;
  saleEvents: SaleEvent[];
  appBaseUrl: string;
  /** ISO datetime. */
  now: string;
}

export interface CycleDeps {
  channel3: Channel3Client;
  scoreModel: Model<ScoreModelInput>;
  decideModel: Model<DecideModelInput>;
  getPriceHistory: (productId: string) => Promise<PricePoint[]>;
  paypal: PayPalClient;
  notifier: Notifier;
  newId: () => string;
  newApprovalToken: () => string;
}

export interface CycleResult {
  decisionId: string;
  search: SearchAndScoreOutput;
  decide: DecideOutput;
  guardrails: GuardrailResult;
  execution: ExecuteOutput;
  llmCalls: LlmCallRecord[];
}

export async function runCycle(input: CycleInput, deps: CycleDeps): Promise<CycleResult> {
  const llmCalls: LlmCallRecord[] = [];

  const search = await searchAndScore(
    { spec: input.spec },
    { channel3: deps.channel3, model: deps.scoreModel },
  );
  if (search.llmCall) llmCalls.push(search.llmCall);

  const candidate = search.output.candidates[0] ?? null;
  const priceHistory = candidate ? await deps.getPriceHistory(candidate.productId) : [];

  const decided = await decide(
    {
      spec: input.spec,
      candidate,
      priceHistory,
      now: input.now,
      saleEvents: input.saleEvents,
      policy: input.policy,
    },
    { model: deps.decideModel },
  );
  if (decided.llmCall) llmCalls.push(decided.llmCall);

  const guardrails = applyGuardrails({
    decision: decided.output.decision,
    candidate,
    policy: input.policy,
    killSwitch: input.killSwitch,
    monthToDateSpendCents: input.monthToDateSpendCents,
  });

  const decisionId = deps.newId();
  const execution = await executeOrNotify(
    {
      orderId: input.orderId,
      userId: input.userId,
      decisionId,
      action: guardrails.action,
      candidate,
      reasoning: decided.output.decision.reasoning,
      guardrailReasons: guardrails.reasons,
      priceSignals: decided.output.priceSignals,
      appBaseUrl: input.appBaseUrl,
      now: input.now,
    },
    { paypal: deps.paypal, notifier: deps.notifier, newApprovalToken: deps.newApprovalToken },
  );

  return {
    decisionId,
    search: search.output,
    decide: decided.output,
    guardrails,
    execution,
    llmCalls,
  };
}
