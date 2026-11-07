// Standing-order lifecycle: queries behind /api/orders/*, plus the rules about which orders may run.
//
// Statuses (standing_orders.status):
//   active        waiting to be checked by a cycle.
//   needs_review  created, but the intent could not be parsed into a spec; a human must fix it.
//   paused        user paused it.
//   filled        a purchase was captured.
//   cancelled     user cancelled it.
//
// Only `active` orders may be picked up by a cycle run. Paused, cancelled, filled and needs_review orders
// must be excluded by whatever drives cycles (the tick loop, when it exists): use RUNNABLE_STATUSES.
import { getPool } from "@/lib/db";
import { parseIntent } from "@/workflows/standing-order/steps/parse-intent";
import type { CreateOrderBody, Spec } from "@/lib/schemas";

export type OrderStatus = "active" | "needs_review" | "paused" | "filled" | "cancelled";

/** The only statuses a cycle run may advance. */
export const RUNNABLE_STATUSES: readonly OrderStatus[] = ["active"];

export function isRunnable(status: string): boolean {
  return (RUNNABLE_STATUSES as readonly string[]).includes(status);
}

/** Which current statuses each user action may move an order out of. */
export const TRANSITIONS = {
  paused: ["active", "needs_review"],
  cancelled: ["active", "needs_review", "paused"],
} as const satisfies Record<string, readonly OrderStatus[]>;

/** Whether a user action may move an order from `current` to `to`. Repeating an action is a no-op, not an error. */
export function decideTransition(current: OrderStatus, to: keyof typeof TRANSITIONS): "same" | "allowed" | "conflict" {
  if (current === to) return "same";
  return (TRANSITIONS[to] as readonly string[]).includes(current) ? "allowed" : "conflict";
}

export interface OrderSummary {
  id: string;
  raw_intent: string;
  max_price_cents: number | null;
  status: OrderStatus;
  created_at: string;
  latest_action: string | null;
}

export interface OrderDetail {
  order: {
    id: string;
    raw_intent: string;
    spec: Spec | null;
    max_price_cents: number | null;
    per_order_cap_cents: number;
    monthly_cap_cents: number;
    merchant_allowlist: string[];
    status: OrderStatus;
    created_at: string;
    updated_at: string;
  };
  latest_candidate: Record<string, unknown> | null;
  decisions: {
    id: string;
    action: string;
    model_action: string;
    guardrail_reasons: string[];
    reasoning: string;
    explanation: string | null;
    created_at: string;
  }[];
  open_approvals: {
    token: string;
    paypal_order_id: string | null;
    approve_url: string | null;
    expires_at: string;
  }[];
  fills: {
    status: string;
    capture_id: string | null;
    amount_cents: number;
    merchant: string;
    paypal_order_id: string | null;
    error: string | null;
    created_at: string;
  }[];
}

export type TransitionResult =
  | { kind: "ok"; status: OrderStatus }
  | { kind: "not_found" }
  | { kind: "conflict"; status: OrderStatus };

/** Everything the order routes read and write. Postgres in production, in-memory in tests. */
export interface OrderStore {
  /** Inserts the row as `needs_review` (no spec yet) so a half-created order is never runnable. */
  insertOrder(row: {
    userId: string;
    rawIntent: string;
    perOrderCapCents: number;
    monthlyCapCents: number;
    merchantAllowlist: string[];
  }): Promise<{ id: string }>;
  /** Stores the parsed spec and makes the order `active`. */
  setParsedSpec(orderId: string, spec: Spec): Promise<void>;
  listOrders(userId: string): Promise<OrderSummary[]>;
  getOrderDetail(orderId: string, userId: string): Promise<OrderDetail | null>;
  transition(orderId: string, userId: string, to: keyof typeof TRANSITIONS): Promise<TransitionResult>;
}

/** "me" for the /api routes until real auth exists. */
export function demoUserId(): string | null {
  return process.env.DEMO_USER_ID || null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function approveUrlFor(paypalOrderId: string | null): string | null {
  if (!paypalOrderId) return null;
  const base = process.env.PAYPAL_API_BASE || "";
  const host = base && !base.includes("sandbox") ? "www.paypal.com" : "www.sandbox.paypal.com";
  return `https://${host}/checkoutnow?token=${encodeURIComponent(paypalOrderId)}`;
}

export function createPgOrderStore(): OrderStore {
  const db = () => getPool();
  return {
    async insertOrder(row) {
      const { rows } = await db().query<{ id: string }>(
        `INSERT INTO standing_orders
           (user_id, raw_intent, per_order_cap_cents, monthly_cap_cents, merchant_allowlist, status)
         VALUES ($1, $2, $3, $4, $5, 'needs_review')
         RETURNING id`,
        [row.userId, row.rawIntent, row.perOrderCapCents, row.monthlyCapCents, row.merchantAllowlist],
      );
      return rows[0];
    },

    async setParsedSpec(orderId, spec) {
      await db().query(
        `UPDATE standing_orders
            SET spec = $2, max_price_cents = $3, status = 'active', updated_at = now()
          WHERE id = $1 AND status = 'needs_review'`,
        [orderId, JSON.stringify(spec), spec.maxPriceCents],
      );
    },

    async listOrders(userId) {
      const { rows } = await db().query<OrderSummary>(
        `SELECT o.id, o.raw_intent, o.max_price_cents, o.status, o.created_at,
                (SELECT d.action FROM decisions d
                  WHERE d.order_id = o.id ORDER BY d.created_at DESC LIMIT 1) AS latest_action
           FROM standing_orders o
          WHERE o.user_id = $1
          ORDER BY o.created_at DESC`,
        [userId],
      );
      return rows;
    },

    async getOrderDetail(orderId, userId) {
      const pool = db();
      const { rows } = await pool.query<OrderDetail["order"]>(
        `SELECT id, raw_intent, spec, max_price_cents, per_order_cap_cents, monthly_cap_cents,
                merchant_allowlist, status, created_at, updated_at
           FROM standing_orders WHERE id = $1 AND user_id = $2`,
        [orderId, userId],
      );
      const order = rows[0];
      if (!order) return null;

      const [candidate, decisions, approvals, fills] = await Promise.all([
        pool.query(
          `SELECT channel3_product_id, merchant, title, url, price_cents, fit_score, fit_reasoning, must_haves, seen_at
             FROM candidates WHERE order_id = $1 ORDER BY seen_at DESC LIMIT 1`,
          [orderId],
        ),
        pool.query<OrderDetail["decisions"][number]>(
          `SELECT id, action, model_action, guardrail_reasons, reasoning, explanation, created_at
             FROM decisions WHERE order_id = $1 ORDER BY created_at DESC`,
          [orderId],
        ),
        pool.query<{ token: string; paypal_order_id: string | null; expires_at: string }>(
          `SELECT a.token, a.paypal_order_id, a.expires_at
             FROM approvals a JOIN decisions d ON d.id = a.decision_id
            WHERE d.order_id = $1 AND a.resolved_at IS NULL AND a.expires_at > now()
            ORDER BY a.created_at DESC`,
          [orderId],
        ),
        pool.query<OrderDetail["fills"][number]>(
          `SELECT status, capture_id, amount_cents, merchant, paypal_order_id, error, created_at
             FROM fills WHERE order_id = $1 ORDER BY created_at DESC`,
          [orderId],
        ),
      ]);

      return {
        order,
        latest_candidate: candidate.rows[0] ?? null,
        decisions: decisions.rows,
        open_approvals: approvals.rows.map((a) => ({ ...a, approve_url: approveUrlFor(a.paypal_order_id) })),
        fills: fills.rows,
      };
    },

    async transition(orderId, userId, to) {
      const pool = db();
      const { rows } = await pool.query<{ status: OrderStatus }>(
        "SELECT status FROM standing_orders WHERE id = $1 AND user_id = $2",
        [orderId, userId],
      );
      const current = rows[0]?.status;
      if (!current) return { kind: "not_found" };
      const verdict = decideTransition(current, to);
      if (verdict === "same") return { kind: "ok", status: current };
      if (verdict === "conflict") return { kind: "conflict", status: current };

      // Guard on the status we read so a concurrent change (e.g. a capture marking it filled) wins.
      const updated = await pool.query(
        `UPDATE standing_orders SET status = $3, updated_at = now()
          WHERE id = $1 AND user_id = $2 AND status = $4`,
        [orderId, userId, to, current],
      );
      if (updated.rowCount) return { kind: "ok", status: to };
      const again = await pool.query<{ status: OrderStatus }>("SELECT status FROM standing_orders WHERE id = $1", [orderId]);
      return { kind: "conflict", status: again.rows[0]?.status ?? current };
    },
  };
}

let store: OrderStore | undefined;

export function getOrderStore(): OrderStore {
  return (store ??= createPgOrderStore());
}

// ---- Create ----

export interface CreateOrderResult {
  id: string;
  status: OrderStatus;
  spec: Spec | null;
  /** Present when the intent could not be parsed; the order exists and is `needs_review`. */
  warning?: string;
}

export interface CreateOrderDeps {
  store: OrderStore;
  /** Resolves the parse model lazily so a missing API key becomes a warning, not a throw. */
  parseModel: () => Parameters<typeof parseIntent>[1]["model"];
  recordLlmCall?: Parameters<typeof parseIntent>[1]["recordLlmCall"];
  today?: () => string;
}

/** Inserts the order, parses its intent, and activates it. Never throws for a bad parse. */
export async function createOrder(
  body: CreateOrderBody,
  userId: string,
  deps: CreateOrderDeps,
): Promise<CreateOrderResult> {
  const { id } = await deps.store.insertOrder({
    userId,
    rawIntent: body.rawIntent,
    perOrderCapCents: body.perOrderCapCents,
    monthlyCapCents: body.monthlyCapCents,
    merchantAllowlist: body.merchantAllowlist,
  });

  let model;
  try {
    model = deps.parseModel();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { id, status: "needs_review", spec: null, warning: `Intent was not parsed: ${message}` };
  }

  const today = (deps.today ?? (() => new Date().toISOString().slice(0, 10)))();
  const parsed = await parseIntent(
    { rawIntent: body.rawIntent, today },
    { model, recordLlmCall: deps.recordLlmCall },
    { orderId: id },
  );
  if (!parsed.ok) {
    return {
      id,
      status: "needs_review",
      spec: null,
      warning: `Intent was not parsed (${parsed.error.kind}): ${parsed.error.message}`,
    };
  }

  try {
    await deps.store.setParsedSpec(id, parsed.output);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { id, status: "needs_review", spec: null, warning: `Intent was parsed but could not be saved: ${message}` };
  }
  return { id, status: "active", spec: parsed.output };
}
