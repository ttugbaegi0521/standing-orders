import type { z } from "zod";
import { hashInput } from "@/lib/hash";
import type { LlmCallRecord, LlmStep, Model } from "./types";

/** Calls a model, validates its output, and returns the audit record alongside it. */
export async function callModel<I, S extends z.ZodType>(
  step: LlmStep,
  model: Model<I>,
  input: I,
  schema: S,
): Promise<{ output: z.infer<S>; llmCall: LlmCallRecord }> {
  const started = Date.now();
  const raw = await model.call(input);
  const output = schema.parse(raw);
  return {
    output,
    llmCall: {
      step,
      model: model.name,
      inputHash: hashInput(input),
      input,
      output,
      durationMs: Date.now() - started,
    },
  };
}
