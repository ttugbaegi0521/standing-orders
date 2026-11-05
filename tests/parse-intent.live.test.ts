// Live Claude calls. Skipped unless ANTHROPIC_API_KEY is set and RUN_LIVE=1:
//   RUN_LIVE=1 npx vitest run tests/parse-intent.live.test.ts
import { describe, expect, it } from "vitest";
import { createClaudeModel } from "@/lib/model";
import { SpecSchema } from "@/lib/schemas";
import { parseIntent } from "@/workflows/standing-order/steps/parse-intent";

const live = Boolean(process.env.ANTHROPIC_API_KEY) && process.env.RUN_LIVE === "1";

const CASES = [
  { name: "clean", rawIntent: "a good 27-inch IPS monitor for coding, under $300, free returns" },
  { name: "ambiguous", rawIntent: "something nice for my dad, not too expensive" },
  { name: "nonsense", rawIntent: "purple seventeen sideways the of when banana" },
];

describe.skipIf(!live)("parseIntent against Claude (live)", () => {
  for (const c of CASES) {
    it(`${c.name}: returns a spec that satisfies the schema with a restatement`, { timeout: 120_000 }, async () => {
      const result = await parseIntent({ rawIntent: c.rawIntent, today: "2026-11-05" }, { model: createClaudeModel() });

      if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`);
      expect(() => SpecSchema.parse(result.output)).not.toThrow();
      expect(result.output.restatement.trim()).not.toBe("");
    });
  }
});
