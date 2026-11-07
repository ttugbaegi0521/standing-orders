// Creates one $1.00 sandbox order and prints its approve URL. Doesn't touch the database.
// Usage: npm run paypal:smoke   (needs PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)
import { randomUUID } from "node:crypto";
import { createOrder } from "@/lib/paypal";

async function main() {
  const base = process.env.STORE_BASE_URL || "http://localhost:3000";
  const order = await createOrder({
    amount_cents: 100,
    currency: "USD",
    reference_id: `smoke-${randomUUID()}`,
    description: "Standing Orders sandbox smoke test",
    return_url: `${base}/api/store/return`,
    cancel_url: `${base}/api/store/cancel`,
  });
  console.log(`PayPal order ${order.paypal_order_id} (${order.status})`);
  console.log(`Approve: ${order.approve_url}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
