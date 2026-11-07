import { demoUserId, getOrderStore, UUID_RE } from "@/lib/orders";

export async function GET(_req: Request, ctx: RouteContext<"/api/orders/[id]">) {
  const { id } = await ctx.params;
  const userId = demoUserId();
  if (!userId) return Response.json({ error: "DEMO_USER_ID is not set" }, { status: 500 });
  if (!UUID_RE.test(id)) return Response.json({ error: "Order not found" }, { status: 404 });

  const detail = await getOrderStore().getOrderDetail(id, userId);
  if (!detail) return Response.json({ error: "Order not found" }, { status: 404 });
  return Response.json(detail);
}
