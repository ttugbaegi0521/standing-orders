import { notImplemented } from "@/lib/http";

export async function POST(_req: Request, ctx: RouteContext<"/api/orders/[id]/cancel">) {
  const { id } = await ctx.params;
  return notImplemented(`POST /api/orders/${id}/cancel`);
}
