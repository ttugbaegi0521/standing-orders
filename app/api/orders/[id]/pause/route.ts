// Pausing excludes the order from cycle runs (see RUNNABLE_STATUSES in lib/orders.ts).
import { demoUserId, getOrderStore, UUID_RE } from "@/lib/orders";

export async function POST(_req: Request, ctx: RouteContext<"/api/orders/[id]/pause">) {
  const { id } = await ctx.params;
  const userId = demoUserId();
  if (!userId) return Response.json({ error: "DEMO_USER_ID is not set" }, { status: 500 });
  if (!UUID_RE.test(id)) return Response.json({ error: "Order not found" }, { status: 404 });

  const result = await getOrderStore().transition(id, userId, "paused");
  if (result.kind === "not_found") return Response.json({ error: "Order not found" }, { status: 404 });
  if (result.kind === "conflict") {
    return Response.json({ error: `Cannot pause an order that is ${result.status}` }, { status: 409 });
  }
  return Response.json({ id, status: result.status });
}
