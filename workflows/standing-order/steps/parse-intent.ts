// Step 1 — Parse intent (LLM, structured output): raw natural language → Spec.
import { SpecSchema, type Spec } from "@/lib/schemas";
import { callModel } from "../call-model";
import type { Model, StepResult } from "../types";

export interface ParseIntentInput {
  rawIntent: string;
  /** ISO date, so relative phrases ("before Christmas") can be resolved. */
  today: string;
}

export interface ParseIntentDeps {
  model: Model<ParseIntentInput>;
}

export async function parseIntent(
  input: ParseIntentInput,
  deps: ParseIntentDeps,
): Promise<StepResult<Spec>> {
  // TODO(Sat): real model = Claude via AI SDK generateObject with SpecSchema.
  return callModel("parse_intent", deps.model, input, SpecSchema);
}
