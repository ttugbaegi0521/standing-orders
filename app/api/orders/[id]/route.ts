import { notImplemented } from "@/lib/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/orders/[id]">) {
  const { id } = await ctx.params;
  // TODO: order status, candidates, decisions.
  return notImplemented(`GET /api/orders/${id}`);
}
