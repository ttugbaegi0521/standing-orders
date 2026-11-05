import { notImplemented } from "@/lib/http";

export async function POST(_req: Request, ctx: RouteContext<"/api/approvals/[token]">) {
  await ctx.params;
  // TODO(Mon): look up approval, capture via lib/paypal.ts, write fills, resume the workflow.
  return notImplemented("POST /api/approvals/:token");
}
