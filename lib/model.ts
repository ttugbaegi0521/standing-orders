// The Claude model used by the workflow's LLM steps, via the Vercel AI SDK.
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export const CLAUDE_MODEL_ID = "claude-opus-5-5";

/**
 * Anthropic options for structured extraction: low effort is enough for turning a request into
 * a spec, and server-side fallbacks retry on another model if this one declines.
 */
export const CLAUDE_PROVIDER_OPTIONS = {
  anthropic: { effort: "low", fallbacks: "default" },
} as const;

export function createClaudeModel(): LanguageModel {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return createAnthropic({ apiKey })(CLAUDE_MODEL_ID);
}

/** Model for the decide step (step 3). Same model id as every other step. */
export function getDecideModel(): LanguageModel {
  return createClaudeModel();
}

/** Model for the search-and-score step (step 2). Same model id as every other step. */
export function getScoreModel(): LanguageModel {
  return createClaudeModel();
}

/**
 * The one rule for whether a web route uses real Claude or the fixture parser: live whenever ANTHROPIC_API_KEY
 * is set. USE_LIVE_MODEL=false forces the fixture even with a key; USE_LIVE_MODEL=true forces live even without
 * one (createClaudeModel then throws a clear error). Unset or empty means "decide from the key".
 * workflow:smoke does not use this: it only goes live when USE_LIVE_MODEL=true.
 */
export function isLiveModelEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const flag = env.USE_LIVE_MODEL?.trim().toLowerCase();
  if (flag === "false") return false;
  if (flag === "true") return true;
  return Boolean(env.ANTHROPIC_API_KEY);
}
