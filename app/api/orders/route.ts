import { notImplemented, parseBody } from "@/lib/http";
import { CreateOrderBodySchema } from "@/lib/schemas";

export async function POST(req: Request) {
  const body = await parseBody(req, CreateOrderBodySchema);
  if (!body.ok) return body.response;
  // TODO: insert standing_orders row, start the Render Workflow, store workflow_id.
  return notImplemented("POST /api/orders");
}
