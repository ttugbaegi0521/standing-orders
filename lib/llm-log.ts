// Audit trail for every LLM call. Logging must never break the step that called it.
import { getPool } from "@/lib/db";
import { hashInput } from "@/lib/hash";
import type { LlmStep } from "@/workflows/standing-order/types";

export interface LlmCallLog {
  step: LlmStep;
  order_id: string | null;
  decision_id?: string | null;
  input: unknown;
  /** The model's output, or { error: "..." } on failure. */
  output: unknown;
  model: string;
  latency_ms: number;
}

let warnedNoDb = false;

export async function recordLlmCall(call: LlmCallLog): Promise<void> {
  if (!process.env.DATABASE_URL) {
    if (!warnedNoDb) console.warn("[llm-log] DATABASE_URL is not set; LLM calls are not being recorded");
    warnedNoDb = true;
    return;
  }
  try {
    await getPool().query(
      `INSERT INTO llm_calls (step, order_id, decision_id, model, input_hash, input, output, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        call.step,
        call.order_id,
        call.decision_id ?? null,
        call.model,
        hashInput(call.input),
        JSON.stringify(call.input),
        JSON.stringify(call.output ?? null),
        Math.round(call.latency_ms),
      ],
    );
  } catch (err) {
    console.error(`[llm-log] failed to record ${call.step} call:`, (err as Error).message);
  }
}
