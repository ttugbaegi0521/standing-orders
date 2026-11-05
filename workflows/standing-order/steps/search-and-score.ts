// Step 2 — Search and score (Channel3 + LLM): Spec → ranked candidates that pass code filters.
import { z } from "zod";
import type { Channel3Client } from "@/lib/channel3";
import {
  CandidateScoreSchema,
  type Product,
  type ScoredCandidate,
  type Spec,
} from "@/lib/schemas";
import { callModel } from "../call-model";
import { FIT_THRESHOLD, MAX_CANDIDATES } from "../config";
import type { Model, StepResult } from "../types";

export interface ScoreModelInput {
  spec: Spec;
  products: Product[];
}

export const ScoreModelOutputSchema = z.object({
  scores: z.array(CandidateScoreSchema),
});

export interface SearchAndScoreDeps {
  channel3: Channel3Client;
  model: Model<ScoreModelInput>;
}

export interface SearchAndScoreOutput {
  /** Passed threshold and every must-have; best fit first, then cheapest. */
  candidates: ScoredCandidate[];
  /** Everything the model scored, including filtered-out products (for the UI). */
  scored: ScoredCandidate[];
  searched: number;
}

export function buildSearchQuery(spec: Spec): string {
  return [spec.category, ...spec.mustHaves].join(" ");
}

export async function searchAndScore(
  input: { spec: Spec },
  deps: SearchAndScoreDeps,
): Promise<StepResult<SearchAndScoreOutput>> {
  const { spec } = input;
  const products = await deps.channel3.search({
    query: buildSearchQuery(spec),
    limit: MAX_CANDIDATES,
  });
  if (products.length === 0) {
    return { output: { candidates: [], scored: [], searched: 0 }, llmCall: null };
  }

  const { output, llmCall } = await callModel(
    "search_and_score",
    deps.model,
    { spec, products },
    ScoreModelOutputSchema,
  );

  // Join scores back onto products by id; ignore any id the model invented.
  const byId = new Map(products.map((p) => [p.productId, p]));
  const scored: ScoredCandidate[] = output.scores.flatMap(({ productId, ...score }) => {
    const product = byId.get(productId);
    return product ? [{ ...product, ...score }] : [];
  });

  const candidates = scored
    .filter((c) => c.fitScore >= FIT_THRESHOLD && c.mustHaves.every((m) => m.pass))
    .sort((a, b) => b.fitScore - a.fitScore || a.priceCents - b.priceCents);

  return { output: { candidates, scored, searched: products.length }, llmCall };
}
