import { describe, expect, it } from "vitest";
import { FAKE_SALE_ORDER, FILL_ORDER, FIXTURE_NOW } from "@/fixtures/demo";
import {
  fixtureChannel3,
  fixtureParseIntentModel,
  fixtureScoreModel,
  rulesDecideModel,
} from "@/fixtures/fakes";
import type { Decision, ScoredCandidate } from "@/lib/schemas";
import { SALE_EVENTS } from "../config";
import { decide, type DecideModelInput } from "../steps/decide";
import { applyGuardrails } from "../steps/guardrails";
import { parseIntent } from "../steps/parse-intent";
import { searchAndScore } from "../steps/search-and-score";
import type { Model } from "../types";

const constModel = <I>(output: unknown): Model<I> => ({ name: "const", call: async () => output });

describe("step 1: parseIntent", () => {
  it("returns a validated spec and an audit record", async () => {
    const { output, llmCall } = await parseIntent(
      { rawIntent: FILL_ORDER.rawIntent, today: "2026-11-05" },
      { model: fixtureParseIntentModel },
    );
    expect(output).toEqual(FILL_ORDER.spec);
    expect(llmCall?.step).toBe("parse_intent");
    expect(llmCall?.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects malformed model output", async () => {
    // Assertion updated for new typed-error contract: parseIntent returns { ok: false } instead of throwing.
    const result = await parseIntent(
      { rawIntent: "x", today: "2026-11-05" },
      { model: constModel({ ...FILL_ORDER.spec, maxPriceCents: -1 }) },
    );
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_output" } });
  });
});

describe("step 2: searchAndScore", () => {
  it("keeps only candidates above threshold that pass every must-have", async () => {
    const { output } = await searchAndScore(
      { spec: FILL_ORDER.spec },
      { channel3: fixtureChannel3(FILL_ORDER.products), model: fixtureScoreModel(FILL_ORDER.scores) },
    );
    expect(output.searched).toBe(3);
    expect(output.scored).toHaveLength(3);
    expect(output.candidates.map((c) => c.productId)).toEqual(["sbx-mon-lumen27q"]);
  });

  it("drops scores for product ids the model invented", async () => {
    const invented = { ...FILL_ORDER.scores[0], productId: "made-up" };
    const { output } = await searchAndScore(
      { spec: FILL_ORDER.spec },
      { channel3: fixtureChannel3(FILL_ORDER.products), model: fixtureScoreModel([invented]) },
    );
    expect(output.scored).toEqual([]);
  });

  it("skips the model when Channel3 returns nothing", async () => {
    const { output, llmCall } = await searchAndScore(
      { spec: FILL_ORDER.spec },
      { channel3: fixtureChannel3([]), model: constModel(null) },
    );
    expect(output.candidates).toEqual([]);
    expect(llmCall).toBeNull();
  });
});

describe("step 3: decide", () => {
  const candidateFor = async (order: typeof FAKE_SALE_ORDER) =>
    (
      await searchAndScore(
        { spec: order.spec },
        { channel3: fixtureChannel3(order.products), model: fixtureScoreModel(order.scores) },
      )
    ).output.candidates[0];

  it("hands the model code-computed fake-sale signals, and the decision is skip", async () => {
    const candidate = await candidateFor(FAKE_SALE_ORDER);
    let seen: DecideModelInput | undefined;
    const spy: Model<DecideModelInput> = {
      name: rulesDecideModel.name,
      call: async (input) => {
        seen = input;
        return rulesDecideModel.call(input);
      },
    };

    const { output } = await decide(
      {
        spec: FAKE_SALE_ORDER.spec,
        candidate,
        priceHistory: FAKE_SALE_ORDER.priceHistory(FIXTURE_NOW)[candidate.productId],
        now: FIXTURE_NOW,
        saleEvents: SALE_EVENTS,
        policy: FAKE_SALE_ORDER.policy,
      },
      { model: spy },
    );

    expect(seen?.priceSignals?.fakeSale.detected).toBe(true);
    expect(seen?.upcomingSaleEvents[0]).toMatchObject({ name: "Black Friday", daysAway: 22 });
    expect(output.decision.action).toBe("skip");
    expect(output.decision.reasoning).toMatch(/fake sale/i);
  });

  it("fills the genuine drop", async () => {
    const candidate = await candidateFor(FILL_ORDER);
    const { output } = await decide(
      {
        spec: FILL_ORDER.spec,
        candidate,
        priceHistory: FILL_ORDER.priceHistory(FIXTURE_NOW)[candidate.productId],
        now: FIXTURE_NOW,
        saleEvents: SALE_EVENTS,
        policy: FILL_ORDER.policy,
      },
      { model: rulesDecideModel },
    );
    expect(output.decision).toMatchObject({ action: "fill", productId: "sbx-mon-lumen27q" });
  });

  it("rejects a decision with an unknown action", async () => {
    await expect(
      decide(
        {
          spec: FILL_ORDER.spec,
          candidate: null,
          priceHistory: [],
          now: FIXTURE_NOW,
          saleEvents: [],
          policy: FILL_ORDER.policy,
        },
        { model: constModel({ action: "buy", productId: null, reasoning: "yolo" }) },
      ),
    ).rejects.toThrow();
  });
});

describe("step 4: applyGuardrails", () => {
  const candidate: ScoredCandidate = {
    ...FILL_ORDER.products[0],
    fitScore: 88,
    mustHaves: [],
    reasoning: "",
  };
  const fill: Decision = { action: "fill", productId: candidate.productId, reasoning: "good" };
  const base = {
    decision: fill,
    candidate,
    policy: FILL_ORDER.policy,
    killSwitch: false,
    monthToDateSpendCents: 0,
  };

  it("lets a compliant fill through untouched", () => {
    expect(applyGuardrails(base)).toEqual({ modelAction: "fill", action: "fill", reasons: [] });
  });

  it("kill switch downgrades to skip", () => {
    expect(applyGuardrails({ ...base, killSwitch: true }).action).toBe("skip");
  });

  it("per-order cap downgrades fill to ask", () => {
    const r = applyGuardrails({ ...base, policy: { ...base.policy, perOrderCapCents: 20000 } });
    expect(r.action).toBe("ask");
    expect(r.reasons[0]).toMatch(/per-order cap/);
  });

  it("monthly cap downgrades fill to ask", () => {
    expect(applyGuardrails({ ...base, monthToDateSpendCents: 50000 }).action).toBe("ask");
  });

  it("non-allowlisted merchant downgrades fill to ask", () => {
    expect(applyGuardrails({ ...base, policy: { ...base.policy, merchantAllowlist: [] } }).action).toBe("ask");
  });

  it("price over the order's max is a skip, not an ask", () => {
    expect(applyGuardrails({ ...base, policy: { ...base.policy, maxPriceCents: 20000 } }).action).toBe("skip");
  });

  it("a decision about a different product is a skip", () => {
    expect(applyGuardrails({ ...base, decision: { ...fill, productId: "other" } }).action).toBe("skip");
  });

  it("never upgrades hold or skip", () => {
    for (const action of ["hold", "skip"] as const) {
      expect(applyGuardrails({ ...base, decision: { ...fill, action } }).action).toBe(action);
    }
  });
});
