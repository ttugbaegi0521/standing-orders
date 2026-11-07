import { fixtureParseIntentModel } from "@/fixtures/fakes";
import { parseBody } from "@/lib/http";
import { createClaudeModel } from "@/lib/model";
import { createOrder, demoUserId, getOrderStore } from "@/lib/orders";
import { CreateOrderBodySchema } from "@/lib/schemas";

// "me" is DEMO_USER_ID until real auth exists.
const noUser = () => Response.json({ error: "DEMO_USER_ID is not set" }, { status: 500 });

/**
 * Creates an order for the demo user and parses its intent into a spec: live Claude when USE_LIVE_MODEL=true,
 * otherwise the fixture parser (which only knows the seeded intents). A failed parse still creates the order,
 * as `needs_review`, with a `warning`.
 */
export async function POST(req: Request) {
  const userId = demoUserId();
  if (!userId) return noUser();
  const body = await parseBody(req, CreateOrderBodySchema);
  if (!body.ok) return body.response;

  const result = await createOrder(body.data, userId, {
    store: getOrderStore(),
    parseModel: () => (process.env.USE_LIVE_MODEL === "true" ? createClaudeModel() : fixtureParseIntentModel),
  });
  return Response.json(result, { status: 201 });
}

/** All of the demo user's orders, newest first, with each one's latest decision action. */
export async function GET() {
  const userId = demoUserId();
  if (!userId) return noUser();
  return Response.json({ orders: await getOrderStore().listOrders(userId) });
}
