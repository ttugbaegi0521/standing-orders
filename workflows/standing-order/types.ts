// Types shared by the workflow steps. Step inputs/outputs stay JSON-serializable
// (ISO strings, not Dates) so they can cross Render Workflow task boundaries.

export type LlmStep = "parse_intent" | "search_and_score" | "decide";

/**
 * A model the workflow can call. Implementations (Claude via the AI SDK, or fixtures)
 * return `unknown`; each step validates the output with its zod schema.
 */
export interface Model<I> {
  name: string;
  call(input: I): Promise<unknown>;
}

/** Persisted to `llm_calls`. */
export interface LlmCallRecord {
  step: LlmStep;
  model: string;
  inputHash: string;
  input: unknown;
  output: unknown;
  durationMs: number;
}

export interface StepResult<T> {
  output: T;
  /** null when the step skipped its model call (e.g. nothing to score). */
  llmCall: LlmCallRecord | null;
}
