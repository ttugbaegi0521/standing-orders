// Live Channel3 + live Claude scoring for step 2. Skipped unless RUN_LIVE=1 and both keys are set:
//   RUN_LIVE=1 npx vitest run tests/search-and-score.live.test.ts
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { fixtureChannel3 } from "@/fixtures/fakes";
import { FILL_ORDER } from "@/fixtures/demo";
import { createChannel3Client } from "@/lib/channel3";
import { getScoreModel } from "@/lib/model";
import type { Spec } from "@/lib/schemas";
import { FIT_THRESHOLD } from "@/workflows/standing-order/config";
import { searchAndScore } from "@/workflows/standing-order/steps/search-and-score";

const live =
  process.env.RUN_LIVE === "1" && Boolean(process.env.ANTHROPIC_API_KEY) && Boolean(process.env.CHANNEL3_API_KEY);

// Must-haves the product title can show; the scorer only sees title, merchant and price.
const spec: Spec = {
  category: "computer monitor",
  mustHaves: ["27-inch"],
  niceToHaves: ["IPS panel"],
  maxPriceCents: 60000,
  constraints: ["new condition"],
  restatement: "A new 27-inch computer monitor under $600.",
};

describe.skipIf(!live)("searchAndScore against live Channel3 + live Claude scoring", () => {
  it("returns scored candidates with the required fields", { timeout: 180_000 }, async () => {
    const logged: unknown[] = [];
    const result = await searchAndScore(
      { spec },
      {
        channel3: createChannel3Client(),
        model: getScoreModel(), // the production live scoring path, not a fixture
        recordLlmCall: async (call) => void logged.push(call),
      },
    );
    if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`);
    const { output } = result;

    expect(output.searched).toBeGreaterThan(0);
    expect(output.scored.length).toBeGreaterThan(0);
    expect(output.candidates.length).toBeGreaterThanOrEqual(1);
    for (const c of output.candidates) {
      expect(c.productId).toBeTruthy();
      expect(c.title).toBeTruthy();
      expect(c.merchant).toBeTruthy();
      expect(c.priceCents).toBeGreaterThan(0);
      expect(c.mustHaves.length).toBeGreaterThan(0);
      expect(c.reasoning.trim()).not.toBe("");
    }
    expect(output.candidates[0].fitScore).toBeGreaterThanOrEqual(FIT_THRESHOLD);
    expect(logged).toHaveLength(1);
  });
});

// Not live: exercises the Claude scoring path (prompt -> generateObject -> join -> filters -> audit log) with a mock model.
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function mockClaude(text: string) {
  return new MockLanguageModelV4({
    modelId: "mock-claude",
    doGenerate: async () => ({
      content: [{ type: "text" as const, text }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage,
      warnings: [],
    }),
  });
}

describe("searchAndScore with a Claude-shaped model (mocked)", () => {
  const products = FILL_ORDER.products;

  it("scores via generateObject, joins on productId, filters, and logs once", async () => {
    const scores = [
      { ...FILL_ORDER.scores[0] },
      { ...FILL_ORDER.scores[1] },
      { productId: "invented-id", fitScore: 99, mustHaves: [{ requirement: "x", pass: true }], reasoning: "ghost" },
    ];
    const logged: { step: string; model: string; order_id: string | null; decision_id?: string | null }[] = [];
    const result = await searchAndScore(
      { spec: FILL_ORDER.spec },
      {
        channel3: fixtureChannel3(products),
        model: mockClaude(JSON.stringify({ scores })),
        recordLlmCall: async (call) => void logged.push(call),
      },
      { orderId: "order-1", decisionId: "decision-1" },
    );

    if (!result.ok) throw new Error(result.error.message);
    expect(result.output.searched).toBe(products.length);
    expect(result.output.scored.map((c) => c.productId)).toEqual([products[0].productId, products[1].productId]);
    expect(result.output.candidates.map((c) => c.productId)).toEqual([products[0].productId]);
    expect(logged).toEqual([
      expect.objectContaining({ step: "search_and_score", model: "mock-claude", order_id: "order-1", decision_id: "decision-1" }),
    ]);
  });

  it("returns a typed error (and still logs) when the model output does not match the schema", async () => {
    const logged: { output: unknown }[] = [];
    const result = await searchAndScore(
      { spec: FILL_ORDER.spec },
      {
        channel3: fixtureChannel3(products),
        model: mockClaude(JSON.stringify({ scores: "nope" })),
        recordLlmCall: async (call) => void logged.push(call),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe("invalid_output");
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged[0].output)).toContain("invalid_output");
  });

  it("makes no model call when search finds nothing", async () => {
    const model = mockClaude("{}");
    const result = await searchAndScore(
      { spec: FILL_ORDER.spec },
      { channel3: fixtureChannel3([]), model, recordLlmCall: async () => undefined },
    );
    expect(result).toMatchObject({ ok: true, output: { searched: 0, candidates: [] }, llmCall: null });
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});
