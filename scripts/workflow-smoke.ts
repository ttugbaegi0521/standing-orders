// Drives both seeded demo orders through steps 2 → 5 against Postgres and the PayPal sandbox, tier-2 only:
// the monitor produces an approval link (you approve as the sandbox buyer, press Enter, we capture),
// the headphones are skipped as a fake sale with no PayPal call at all.
//
// The scoring and decide steps use fixture models unless USE_LIVE_MODEL=true (real Claude for both, needs
// ANTHROPIC_API_KEY); search uses the fixture Channel3 unless USE_LIVE_CHANNEL3=true (needs CHANNEL3_API_KEY).
// Live failures are reported, never replaced by the fixture. No Vault. Needs DATABASE_URL (migrated + seeded),
// PAYPAL_CLIENT_ID/SECRET and DEMO_USER_ID. AGENT_READY_MERCHANTS must be empty/unset so everything is tier 2.
// Usage: npm run workflow:smoke
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { POST as captureApproval } from "@/app/api/approvals/[token]/route";
import { FIXTURE_ORDERS, type FixtureOrder } from "@/fixtures/demo";
import { createChannel3Client } from "@/lib/channel3";
import { fixtureChannel3, fixtureScoreModel, rulesDecideModel } from "@/fixtures/fakes";
import { getPool } from "@/lib/db";
import { recordLlmCall, type LlmCallLog } from "@/lib/llm-log";
import { getDecideModel, getScoreModel } from "@/lib/model";
import { consoleNotifier, type Notifier } from "@/lib/notify";
import { createPayPalClient } from "@/lib/paypal";
import { OrderPolicySchema, SpecSchema, type PricePoint } from "@/lib/schemas";
import { SALE_EVENTS } from "@/workflows/standing-order/config";
import { decide } from "@/workflows/standing-order/steps/decide";
import {
  createPgExecutePersistence,
  executeOrNotify,
  type ExecuteOutput,
} from "@/workflows/standing-order/steps/execute";
import { applyGuardrails } from "@/workflows/standing-order/steps/guardrails";
import { searchAndScore } from "@/workflows/standing-order/steps/search-and-score";

const USE_LIVE_MODEL = process.env.USE_LIVE_MODEL === "true";
const USE_LIVE_CHANNEL3 = process.env.USE_LIVE_CHANNEL3 === "true";
const POLL_MS = 3_000;
const POLL_TIMEOUT_MS = 60_000;

interface OrderRow {
  id: string;
  user_id: string;
  spec: unknown;
  max_price_cents: number;
  per_order_cap_cents: number;
  monthly_cap_cents: number;
  merchant_allowlist: string[];
}

interface FillRow {
  status: string;
  paypal_order_id: string | null;
  capture_id: string | null;
  error: string | null;
}

const db = () => getPool();

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

/** One full cycle for a seeded order, persisting through execute's Postgres dependency. */
async function runOrder(row: OrderRow, fixture: FixtureOrder, notifier: Notifier) {
  const now = new Date().toISOString();
  const spec = SpecSchema.parse(row.spec);
  const policy = OrderPolicySchema.parse({
    maxPriceCents: row.max_price_cents,
    perOrderCapCents: row.per_order_cap_cents,
    monthlyCapCents: row.monthly_cap_cents,
    merchantAllowlist: row.merchant_allowlist,
  });
  const { rows: user } = await db().query<{ kill_switch: boolean }>(
    "SELECT kill_switch FROM users WHERE id = $1",
    [row.user_id],
  );
  const { rows: spend } = await db().query<{ cents: string }>(
    `SELECT COALESCE(SUM(f.amount_cents), 0) AS cents
       FROM fills f JOIN standing_orders o ON o.id = f.order_id
      WHERE o.user_id = $1 AND f.status = 'captured' AND f.created_at >= date_trunc('month', now())`,
    [row.user_id],
  );

  const decisionId = randomUUID();
  // llm_calls.decision_id references decisions(id), which execute writes later, so live-model audit rows are
  // held until then. If a live step fails, execute never runs and the rows are logged without a decision id.
  const pendingLlmLogs: LlmCallLog[] = [];
  const deferLog = async (call: LlmCallLog) => void pendingLlmLogs.push(call);
  const flushWithoutDecision = async () => {
    for (const call of pendingLlmLogs) await recordLlmCall({ ...call, decision_id: null });
  };

  const channel3 = USE_LIVE_CHANNEL3 ? createChannel3Client() : fixtureChannel3(fixture.products);
  let search;
  if (USE_LIVE_MODEL) {
    const live = await searchAndScore(
      { spec },
      { channel3, model: getScoreModel(), recordLlmCall: deferLog },
      { orderId: row.id, decisionId },
    );
    if (!live.ok) {
      await flushWithoutDecision();
      throw new Error(`search-and-score (live model) failed: ${live.error.kind}: ${live.error.message}`);
    }
    search = live;
  } else {
    search = await searchAndScore({ spec }, { channel3, model: fixtureScoreModel(fixture.scores) });
  }
  if (USE_LIVE_CHANNEL3 || USE_LIVE_MODEL) {
    const o = search.output;
    console.log(
      `Search (channel3: ${USE_LIVE_CHANNEL3 ? "live" : "fake"}, scoring: ${USE_LIVE_MODEL ? "live claude" : "fake"}): ` +
        `${o.searched} products searched, ${o.scored.length} scored, ${o.candidates.length} candidate(s)`,
    );
  }
  const candidate = search.output.candidates[0] ?? null;

  let priceHistory: PricePoint[] = [];
  if (candidate) {
    const { rows } = await db().query<{ price_cents: number; observed_at: Date }>(
      "SELECT price_cents, observed_at FROM price_points WHERE product_id = $1 ORDER BY observed_at",
      [candidate.productId],
    );
    priceHistory = rows.map((r) => ({ priceCents: r.price_cents, observedAt: r.observed_at.toISOString() }));
  }

  const decideInput = { spec, candidate, priceHistory, now, saleEvents: SALE_EVENTS, policy };
  let decided;
  if (USE_LIVE_MODEL) {
    const live = await decide(
      decideInput,
      { model: getDecideModel(), recordLlmCall: deferLog },
      { orderId: row.id, decisionId },
    );
    if (!live.ok) {
      await flushWithoutDecision();
      throw new Error(`decide (live model) failed: ${live.error.kind}: ${live.error.message}`);
    }
    decided = live;
  } else {
    decided = await decide(decideInput, { model: rulesDecideModel });
  }
  const guardrails = applyGuardrails({
    decision: decided.output.decision,
    candidate,
    policy,
    killSwitch: user[0]?.kill_switch ?? false,
    monthToDateSpendCents: Number(spend[0]?.cents ?? 0),
  });

  const execution = await executeOrNotify(
    {
      orderId: row.id,
      userId: row.user_id,
      decisionId,
      action: guardrails.action,
      modelAction: guardrails.modelAction,
      candidate,
      reasoning: decided.output.decision.reasoning,
      guardrailReasons: guardrails.reasons,
      priceSignals: decided.output.priceSignals,
      llmInputHash: decided.llmCall?.inputHash ?? null,
      appBaseUrl: process.env.APP_BASE_URL || "http://localhost:3000",
      now,
    },
    {
      paypal: createPayPalClient(),
      notifier,
      newApprovalToken: () => randomUUID(),
      persistence: createPgExecutePersistence(),
    },
  );
  for (const call of pendingLlmLogs) await recordLlmCall(call);
  return { decisionId, candidate, decision: decided.output.decision, signals: decided.output.priceSignals, guardrails, execution };
}

function printChosen(r: Awaited<ReturnType<typeof runOrder>>) {
  const c = r.candidate;
  console.log(
    c
      ? `Candidate: ${c.title} — ${c.merchant} — $${(c.priceCents / 100).toFixed(2)} (fit ${c.fitScore})`
      : "Candidate: none",
  );
  console.log(`Decision: ${r.decision.action} (after guardrails: ${r.guardrails.action})`);
  console.log(`Reasoning: ${r.decision.reasoning}`);
  if (r.guardrails.reasons.length) console.log(`Guardrails: ${r.guardrails.reasons.join("; ")}`);
}

async function latestFill(decisionId: string): Promise<FillRow | null> {
  const { rows } = await db().query<FillRow>(
    "SELECT status, paypal_order_id, capture_id, error FROM fills WHERE decision_id = $1",
    [decisionId],
  );
  return rows[0] ?? null;
}

/** Monitor order: print the approval link, wait for the human, capture, and confirm the fill row. */
async function driveFill(row: OrderRow, fixture: FixtureOrder): Promise<{ captureId: string | null; ok: boolean }> {
  section(`Monitor order ${row.id}`);
  let approveUrl: string | undefined;
  const notifier: Notifier = {
    async send(n) {
      if (n.link) approveUrl = n.link;
      await consoleNotifier.send(n);
    },
  };
  const r = await runOrder(row, fixture, notifier);
  printChosen(r);

  const out: ExecuteOutput = r.execution;
  if (out.kind !== "approval_requested") {
    console.error(`\nExpected a tier-2 approval request but step 5 returned "${out.kind}": ${out.explanation}`);
    if (out.kind === "error") console.error(`${out.error.code}: ${out.error.message}`);
    return { captureId: null, ok: false };
  }

  const { rows } = await db().query(
    "SELECT token, paypal_order_id, expires_at FROM approvals WHERE decision_id = $1",
    [r.decisionId],
  );
  console.log(`\nApprovals row: ${JSON.stringify(rows[0])}`);
  console.log(`Approval link (PayPal sandbox): ${approveUrl ?? "(none)"}`);
  console.log("Open it, log in as the sandbox personal buyer, approve, then come back here.");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("\nPress Enter once you have approved in the browser... ");
  rl.close();

  // PayPal's return page (/approvals/<token>) is not built yet, so the capture is the same POST it would make.
  const token = out.approval.token;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let fill = await latestFill(r.decisionId);
  let lastCapture = "";
  while (Date.now() < deadline) {
    const res = await captureApproval(new Request(`http://local/api/approvals/${token}`, { method: "POST" }), {
      params: Promise.resolve({ token }),
    } as never);
    lastCapture = `${res.status} ${await res.text()}`;
    fill = await latestFill(r.decisionId);
    if (fill?.status === "captured") break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  if (fill?.status === "captured") {
    console.log(`\nCaptured. Capture id: ${fill.capture_id}`);
    console.log(`Fill row: ${JSON.stringify(fill)}`);
    return { captureId: fill.capture_id, ok: true };
  }
  console.error(
    `\nNot captured after ${POLL_TIMEOUT_MS / 1000}s. Last fill status: ${fill?.status ?? "no fill row"}` +
      `${fill?.error ? ` (${fill.error})` : ""}. Last capture response: ${lastCapture}`,
  );
  console.error("Did you finish approving in the PayPal popup before pressing Enter?");
  return { captureId: null, ok: false };
}

/** Headphones order: expect a skip, no PayPal call, no approvals row, no fills row. */
async function driveRefusal(row: OrderRow, fixture: FixtureOrder): Promise<{ reason: string | null; ok: boolean }> {
  section(`Headphones order ${row.id}`);
  const r = await runOrder(row, fixture, consoleNotifier);
  printChosen(r);
  console.log(`Price signals: ${JSON.stringify(r.signals)}`);

  const [{ rows: approvals }, { rows: fills }] = await Promise.all([
    db().query("SELECT 1 FROM approvals WHERE decision_id = $1", [r.decisionId]),
    db().query("SELECT 1 FROM fills WHERE decision_id = $1", [r.decisionId]),
  ]);
  const clean = approvals.length === 0 && fills.length === 0;
  console.log(`approvals rows: ${approvals.length}, fills rows: ${fills.length} → ${clean ? "none created, as expected" : "UNEXPECTED"}`);

  const skipped = r.guardrails.action === "skip" && r.signals?.fakeSale.detected === true;
  if (!skipped) console.error("Expected a skip on a detected fake sale.");
  return { reason: skipped ? r.decision.reasoning : null, ok: skipped && clean };
}

async function main() {
  const modelMode = USE_LIVE_MODEL ? "live claude" : "fake";
  console.log(`decide model: ${modelMode} | score model: ${modelMode} | channel3: ${USE_LIVE_CHANNEL3 ? "live" : "fake"}`);
  if (USE_LIVE_CHANNEL3) {
    console.log(
      USE_LIVE_MODEL
        ? "note: live Channel3 products have no price history (only the seeded product ids do), so the fake-sale " +
          "refusal cannot trigger for them, and a must-have the product data cannot show (such as free returns) fails."
        : "note: the fixture score model and seeded price_points only know the seeded product ids, so live " +
          "Channel3 products usually yield no candidate; set USE_LIVE_MODEL=true to score them with Claude.",
    );
  }
  const userId = process.env.DEMO_USER_ID;
  if (!userId) throw new Error("DEMO_USER_ID is not set");
  if ((process.env.AGENT_READY_MERCHANTS ?? "").trim()) {
    throw new Error(
      "AGENT_READY_MERCHANTS is set. This smoke test is tier-2 only (no Vault): leave it empty or unset.",
    );
  }

  const { rows } = await db().query<OrderRow>(
    `SELECT id, user_id, spec, max_price_cents, per_order_cap_cents, monthly_cap_cents, merchant_allowlist
       FROM standing_orders WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [userId, FIXTURE_ORDERS.map((o) => o.id)],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const [fillFixture, refusalFixture] = FIXTURE_ORDERS;
  const fillRow = byId.get(fillFixture.id);
  const refusalRow = byId.get(refusalFixture.id);
  if (!fillRow || !refusalRow) throw new Error("Seeded orders not found for DEMO_USER_ID. Run: npm run db:migrate && npm run db:seed");

  // A failing live model on one order should not hide the other's result.
  const attempt = async <T extends { ok: boolean }>(run: () => Promise<T>, failed: T): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      return failed;
    }
  };
  const fill = await attempt(() => driveFill(fillRow, fillFixture), { captureId: null, ok: false });
  const refusal = await attempt(() => driveRefusal(refusalRow, refusalFixture), { reason: null, ok: false });

  section("Summary");
  console.log(`Fill: ${fill.captureId ?? "NONE"} Refusal: ${refusal.reason ?? "NONE"}`);
  if (!fill.ok || !refusal.ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // getPool() throws when DATABASE_URL is unset; don't let that bury the real error.
    try {
      await getPool().end();
    } catch {
      /* no pool to close */
    }
  });
