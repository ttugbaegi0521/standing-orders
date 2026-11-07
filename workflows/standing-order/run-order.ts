// The persisted watch loop: one real cycle for one order (runOrderCycle) and the driver that runs every due
// order (tickOnce). Unlike run-cycle.ts (in-memory, used by fixture tests) this reads and writes Postgres:
// it records Channel3 prices so history builds up across ticks, writes decisions/fills/approvals through
// execute's persistence, and schedules the order's next check.
import { randomBytes, randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import { createChannel3Client, type Channel3Client } from "@/lib/channel3";
import { recordLlmCall, type LlmCallLog } from "@/lib/llm-log";
import { formatUsd } from "@/lib/money";
import { getDecideModel, getScoreModel } from "@/lib/model";
import { claimDueOrders, type DueOrder } from "@/lib/orders";
import { consoleNotifier, type Notifier } from "@/lib/notify";
import { createPayPalClient, type PayPalClient } from "@/lib/paypal";
import { getPriceHistory, recordPrices, type Queryable } from "@/lib/price-history";
import {
  OrderPolicySchema,
  SpecSchema,
  type Action,
  type OrderPolicy,
  type Product,
  type Spec,
} from "@/lib/schemas";
import { HOLD_RECHECK_MINUTES, SALE_EVENTS, TICK_BATCH_LIMIT, TICK_LEASE_MINUTES } from "./config";
import { decide, type DecideModelInput } from "./steps/decide";
import {
  createPgExecutePersistence,
  executeOrNotify,
  type ExecuteOutput,
  type ExecutePersistence,
} from "./steps/execute";
import { applyGuardrails, KILL_SWITCH_REASON, KILL_SWITCH_REASONING } from "./steps/guardrails";
import { searchAndScore, type ScoreModelInput } from "./steps/search-and-score";
import type { Model } from "./types";

export type ScoreModel = LanguageModel | Model<ScoreModelInput>;
export type DecideModel = LanguageModel | Model<DecideModelInput>;

export interface RunOrderDeps {
  db: Queryable;
  channel3: Channel3Client;
  scoreModel: ScoreModel;
  decideModel: DecideModel;
  paypal: PayPalClient;
  notify: Notifier;
  now: () => Date;
  /** Where execute writes decisions, fills and approvals. Defaults to Postgres. */
  persistence?: ExecutePersistence;
  newId?: () => string;
  newApprovalToken?: () => string;
  appBaseUrl?: string;
}

/** How many of a check's top-scored products are stored for the order page. */
const CONSIDERED_LIMIT = 5;

export type CycleAction = Action | "needs_review" | "awaiting_approval";

export interface CycleSummary {
  orderId: string;
  action: CycleAction;
  candidate: { productId: string; title: string; merchant: string; priceCents: number } | null;
  reasoning: string;
  nextCheckAt: string | null;
  /** What step 5 did, if it ran. */
  execution: ExecuteOutput["kind"] | null;
  decisionId?: string;
  /** Set when execute returned a typed error. */
  error?: string;
}

function isFakeModel<I>(model: unknown): model is Model<I> {
  return typeof model === "object" && model !== null && "call" in model && typeof model.call === "function";
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

async function schedule(db: Queryable, orderId: string, now: Date, nextCheckAt: Date | null) {
  await db.query(
    "UPDATE standing_orders SET last_checked_at = $2, next_check_at = $3, updated_at = now() WHERE id = $1",
    [orderId, now.toISOString(), nextCheckAt?.toISOString() ?? null],
  );
}

/**
 * One full persisted cycle for one order. Never calls a model for an order without a spec. If anything throws,
 * the order is still pushed out by the recheck interval (so a failing order is not retried every tick) and the
 * error is rethrown for the caller to report.
 */
export async function runOrderCycle(order: DueOrder, deps: RunOrderDeps): Promise<CycleSummary> {
  const now = deps.now();
  const empty = (action: CycleAction, reasoning: string, nextCheckAt: Date | null = null): CycleSummary => ({
    orderId: order.id,
    action,
    candidate: null,
    reasoning,
    nextCheckAt: nextCheckAt?.toISOString() ?? null,
    execution: null,
  });

  const parsedSpec = order.spec == null ? null : SpecSchema.safeParse(order.spec);
  if (!parsedSpec?.success) {
    return empty("needs_review", parsedSpec ? "The stored spec is invalid." : "The order has no spec yet.");
  }
  const spec: Spec = parsedSpec.data;

  try {
    return await cycle(order, spec, deps, now);
  } catch (err) {
    await schedule(deps.db, order.id, now, addMinutes(now, HOLD_RECHECK_MINUTES)).catch(() => undefined);
    throw err;
  }
}

async function cycle(order: DueOrder, spec: Spec, deps: RunOrderDeps, now: Date): Promise<CycleSummary> {
  const { db } = deps;
  const recheck = addMinutes(now, HOLD_RECHECK_MINUTES);

  // An approval is already waiting on this order: don't open a second PayPal order for it.
  const open = await db.query(
    `SELECT 1 FROM approvals a JOIN decisions d ON d.id = a.decision_id
      WHERE d.order_id = $1 AND a.resolved_at IS NULL AND a.expires_at > $2::timestamptz LIMIT 1`,
    [order.id, now.toISOString()],
  );
  if (open.rows.length > 0) {
    await schedule(db, order.id, now, recheck);
    return {
      orderId: order.id,
      action: "awaiting_approval",
      candidate: null,
      reasoning: "An approval request is still open for this order.",
      nextCheckAt: recheck.toISOString(),
      execution: null,
    };
  }

  const policy: OrderPolicy = OrderPolicySchema.parse({
    maxPriceCents: order.max_price_cents ?? spec.maxPriceCents,
    perOrderCapCents: order.per_order_cap_cents,
    monthlyCapCents: order.monthly_cap_cents,
    merchantAllowlist: order.merchant_allowlist,
  });
  const decisionId = (deps.newId ?? randomUUID)();

  // llm_calls.decision_id references decisions(id), which execute writes later, so live-model audit rows are
  // held until then. If a live step fails, execute never runs and they are logged without a decision id.
  const pendingLogs: LlmCallLog[] = [];
  const deferLog = async (call: LlmCallLog) => void pendingLogs.push(call);
  const flushWithoutDecision = async () => {
    for (const call of pendingLogs) await recordLlmCall({ ...call, decision_id: null });
  };

  // Step 2: search (remembering every product Channel3 returned) and score.
  const seen: Product[] = [];
  const channel3: Channel3Client = {
    async search(params) {
      const products = await deps.channel3.search(params);
      seen.push(...products);
      return products;
    },
  };
  let search;
  if (isFakeModel<ScoreModelInput>(deps.scoreModel)) {
    search = await searchAndScore({ spec }, { channel3, model: deps.scoreModel });
  } else {
    const live = await searchAndScore(
      { spec },
      { channel3, model: deps.scoreModel, recordLlmCall: deferLog },
      { orderId: order.id, decisionId },
    );
    if (!live.ok) {
      await flushWithoutDecision();
      throw new Error(`scoring failed: ${live.error.kind}: ${live.error.message}`);
    }
    search = live;
  }
  // Build price history for every product seen, not just the winner.
  await recordPrices(
    db,
    seen.map((p) => ({ productId: p.productId, priceCents: p.priceCents })),
    now,
  );

  const candidate = search.output.candidates[0] ?? null;

  // Keep the top-scored products from this check, not only the pick, so the order page can show what was
  // considered. The pick is always kept, even when failed must-haves leave higher scores below it.
  const considered = [...search.output.scored]
    .sort((a, b) => b.fitScore - a.fitScore || a.priceCents - b.priceCents)
    .slice(0, CONSIDERED_LIMIT);
  if (candidate && !considered.some((c) => c.productId === candidate.productId)) {
    considered.length = Math.min(considered.length, CONSIDERED_LIMIT - 1);
    considered.push(candidate);
  }
  if (considered.length > 0) {
    const COLUMNS = 11;
    const placeholders = considered
      .map((_, i) => `(${Array.from({ length: COLUMNS }, (_, j) => `$${i * COLUMNS + j + 1}`).join(", ")})`)
      .join(", ");
    await db
      .query(
        `INSERT INTO candidates
           (order_id, channel3_product_id, merchant, title, url, price_cents, fit_score, fit_reasoning, must_haves, seen_at, chosen)
         VALUES ${placeholders}`,
        considered.flatMap((c) => [
          order.id,
          c.productId,
          c.merchant,
          c.title,
          c.url,
          c.priceCents,
          c.fitScore,
          c.reasoning,
          JSON.stringify(c.mustHaves),
          now.toISOString(),
          c.productId === candidate?.productId,
        ]),
      )
      .catch((err) => console.error("[run-order] could not store candidates:", (err as Error).message));
  }

  // Step 3: decide, on history that excludes the observation just recorded.
  const priceHistory = candidate ? await getPriceHistory(db, candidate.productId, { before: now }) : [];
  const decideInput = { spec, candidate, priceHistory, now: now.toISOString(), saleEvents: SALE_EVENTS, policy };
  let decided;
  if (isFakeModel<DecideModelInput>(deps.decideModel)) {
    decided = await decide(decideInput, { model: deps.decideModel });
  } else {
    const live = await decide(
      decideInput,
      { model: deps.decideModel, recordLlmCall: deferLog },
      { orderId: order.id, decisionId },
    );
    if (!live.ok) {
      await flushWithoutDecision();
      throw new Error(`decide failed: ${live.error.kind}: ${live.error.message}`);
    }
    decided = live;
  }

  // Step 4: guardrails (kill switch and month-to-date spend read fresh from the database).
  const [user, spend] = await Promise.all([
    db.query<{ kill_switch: boolean }>("SELECT kill_switch FROM users WHERE id = $1", [order.user_id]),
    db.query<{ cents: string }>(
      `SELECT COALESCE(SUM(f.amount_cents), 0) AS cents
         FROM fills f JOIN standing_orders o ON o.id = f.order_id
        WHERE o.user_id = $1 AND f.status = 'captured' AND f.created_at >= date_trunc('month', $2::timestamptz)`,
      [order.user_id, now.toISOString()],
    ),
  ]);
  const killSwitchOn = user.rows[0]?.kill_switch ?? false;
  const guardrails = applyGuardrails({
    decision: decided.output.decision,
    candidate,
    policy,
    killSwitch: killSwitchOn,
    monthToDateSpendCents: Number(spend.rows[0]?.cents ?? 0),
  });

  // Kill switch: a proposed purchase stops here, before execute, so no fill, approval or PayPal order can be
  // created while it is on. The decision is still recorded (what the model proposed, and why nothing happened).
  if (killSwitchOn && (guardrails.modelAction === "fill" || guardrails.modelAction === "ask")) {
    const explanation = candidate
      ? `The kill switch is on, so I did not buy "${candidate.title}" from ${candidate.merchant} at ${formatUsd(candidate.priceCents)}. Turn it off to let the agent buy again.`
      : "The kill switch is on, so I did not buy anything. Turn it off to let the agent buy again.";
    await (deps.persistence ?? createPgExecutePersistence()).recordDecision({
      id: decisionId,
      orderId: order.id,
      modelAction: guardrails.modelAction,
      action: "skip",
      reasoning: KILL_SWITCH_REASONING,
      guardrailReasons: [KILL_SWITCH_REASON],
      explanation,
      llmInputHash: decided.llmCall?.inputHash ?? null,
    });
    for (const call of pendingLogs) await recordLlmCall(call);
    await deps.notify.send({ userId: order.user_id, subject: "Standing order: skip", body: explanation });
    await schedule(db, order.id, now, recheck);
    return {
      orderId: order.id,
      action: "skip",
      candidate: candidate
        ? { productId: candidate.productId, title: candidate.title, merchant: candidate.merchant, priceCents: candidate.priceCents }
        : null,
      reasoning: KILL_SWITCH_REASONING,
      nextCheckAt: recheck.toISOString(),
      execution: "none",
      decisionId,
    };
  }

  // Step 5: execute with full persistence (decision, pending fill, approval, real PayPal order).
  const execution = await executeOrNotify(
    {
      orderId: order.id,
      userId: order.user_id,
      decisionId,
      action: guardrails.action,
      modelAction: guardrails.modelAction,
      candidate,
      reasoning: decided.output.decision.reasoning,
      guardrailReasons: guardrails.reasons,
      priceSignals: decided.output.priceSignals,
      llmInputHash: decided.llmCall?.inputHash ?? null,
      appBaseUrl: deps.appBaseUrl ?? (process.env.APP_BASE_URL || "http://localhost:3000"),
      now: now.toISOString(),
    },
    {
      paypal: deps.paypal,
      notifier: deps.notify,
      newApprovalToken: deps.newApprovalToken ?? (() => randomBytes(24).toString("base64url")),
      persistence: deps.persistence ?? createPgExecutePersistence(),
    },
  );
  for (const call of pendingLogs) await recordLlmCall(call);

  // Scheduling. Hold, skip, refusals and errors keep watching; a pending approval waits for its expiry;
  // a captured tier-1 fill ends the order.
  let nextCheckAt: Date | null = recheck;
  if (execution.kind === "approval_requested") {
    nextCheckAt = new Date(execution.approval.expiresAt);
  } else if (execution.kind === "filled" && execution.fill.status === "captured") {
    nextCheckAt = null;
    await db.query("UPDATE standing_orders SET status = 'filled', updated_at = now() WHERE id = $1", [order.id]);
  }
  await schedule(db, order.id, now, nextCheckAt);

  return {
    orderId: order.id,
    action: guardrails.action,
    candidate: candidate
      ? { productId: candidate.productId, title: candidate.title, merchant: candidate.merchant, priceCents: candidate.priceCents }
      : null,
    reasoning: decided.output.decision.reasoning,
    nextCheckAt: nextCheckAt?.toISOString() ?? null,
    execution: execution.kind,
    decisionId,
    ...(execution.kind === "error" && { error: `${execution.error.code}: ${execution.error.message}` }),
  };
}

// ---- Tick ----

export interface TickResult {
  checked: number;
  results: (CycleSummary | { orderId: string; error: string })[];
}

/** Claims every due order (up to TICK_BATCH_LIMIT) and runs a cycle for each. One failure never aborts the batch. */
export async function tickOnce(deps: RunOrderDeps): Promise<TickResult> {
  const due = await claimDueOrders(deps.db, deps.now(), TICK_BATCH_LIMIT, TICK_LEASE_MINUTES);
  const results: TickResult["results"] = [];
  for (const order of due) {
    try {
      results.push(await runOrderCycle(order, deps));
    } catch (err) {
      results.push({ orderId: order.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { checked: due.length, results };
}

/** Env vars the live loop cannot run without. */
export function missingLiveKeys(): string[] {
  return ["ANTHROPIC_API_KEY", "CHANNEL3_API_KEY"].filter((k) => !process.env[k]);
}

/** The real loop's dependencies: live Channel3, live Claude for scoring and decide, real PayPal. No fixtures. */
export function buildLiveDeps(db: Queryable): RunOrderDeps {
  return {
    db,
    channel3: createChannel3Client(),
    scoreModel: getScoreModel(),
    decideModel: getDecideModel(),
    paypal: createPayPalClient(),
    notify: consoleNotifier,
    now: () => new Date(),
  };
}
