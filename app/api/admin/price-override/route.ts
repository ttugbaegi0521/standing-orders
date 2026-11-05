// Demo only: inject a fake price for a product id into the watch loop.
import { notImplemented, parseBody } from "@/lib/http";
import { PriceOverrideBodySchema } from "@/lib/schemas";

export async function POST(req: Request) {
  const body = await parseBody(req, PriceOverrideBodySchema);
  if (!body.ok) return body.response;
  // TODO: insert price_points row with source = 'override'.
  return notImplemented("POST /api/admin/price-override");
}
