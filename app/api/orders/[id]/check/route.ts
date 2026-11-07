// On-demand check of one order, for the UI's "Check now". Runs the same live cycle the tick runs, once,
// ignoring next_check_at. Paused, cancelled and filled orders are refused.
import { getPool } from "@/lib/db";
import { demoUserId, UUID_RE, type DueOrder } from "@/lib/orders";
import { buildLiveDeps, missingLiveKeys, runOrderCycle } from "@/workflows/standing-order/run-order";

// Orders a check may run for. (needs_review is allowed: the cycle answers needs_review without calling a model.)
const CHECKABLE = ["active", "needs_review"];

export async function POST(_req: Request, ctx: RouteContext<"/api/orders/[id]/check">) {
  const { id } = await ctx.params;
  const userId = demoUserId();
  if (!userId) return Response.json({ error: "DEMO_USER_ID is not set" }, { status: 500 });
  if (!UUID_RE.test(id)) return Response.json({ error: "Order not found" }, { status: 404 });

  const db = getPool();
  const { rows } = await db.query<DueOrder>(
    `SELECT id, user_id, spec, max_price_cents, per_order_cap_cents, monthly_cap_cents, merchant_allowlist, status
       FROM standing_orders WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  const order = rows[0];
  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
  if (!CHECKABLE.includes(order.status)) {
    return Response.json({ error: `Cannot check an order that is ${order.status}` }, { status: 409 });
  }

  const missing = missingLiveKeys();
  if (missing.length > 0) {
    return Response.json(
      { error: `A check runs live and needs ${missing.join(" and ")}. Nothing was checked.` },
      { status: 503 },
    );
  }

  try {
    return Response.json(await runOrderCycle(order, buildLiveDeps(db)));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
