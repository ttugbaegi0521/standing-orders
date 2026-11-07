// PayPal webhooks. Every delivery is verified with PayPal (PAYPAL_WEBHOOK_ID) before we act on it.
import { z } from "zod";
import { getPool } from "@/lib/db";
import { verifyWebhookSignature } from "@/lib/paypal";

const EventSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  resource: z
    .object({
      id: z.string(),
      supplementary_data: z
        .object({ related_ids: z.object({ order_id: z.string().optional() }).optional() })
        .optional(),
    })
    .loose(),
});

export async function POST(req: Request) {
  const rawBody = await req.text();

  let verified: boolean;
  try {
    verified = await verifyWebhookSignature(req.headers, rawBody);
  } catch (err) {
    // Couldn't ask PayPal (or misconfigured): 503 so PayPal retries the delivery later.
    console.error("[webhooks/paypal] could not verify signature", err);
    return Response.json({ error: "verification unavailable" }, { status: 503 });
  }
  if (!verified) {
    console.warn("[webhooks/paypal] rejected delivery with invalid signature", {
      transmissionId: req.headers.get("paypal-transmission-id"),
    });
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  const parsed = EventSchema.safeParse(JSON.parse(rawBody));
  if (!parsed.success) {
    console.warn("[webhooks/paypal] verified event with unexpected shape", parsed.error.issues);
    return Response.json({ received: true });
  }
  const event = parsed.data;
  const db = getPool();

  if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
    await db.query(
      "UPDATE store_orders SET status = 'approved' WHERE paypal_order_id = $1 AND status = 'created'",
      [event.resource.id],
    );
  } else if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    const orderId = event.resource.supplementary_data?.related_ids?.order_id;
    if (orderId) {
      await db.query(
        `UPDATE store_orders
         SET status = 'captured', capture_id = $2, captured_at = coalesce(captured_at, now())
         WHERE paypal_order_id = $1`,
        [orderId, event.resource.id],
      );
    } else {
      console.warn("[webhooks/paypal] capture event without an order id", event.id);
    }
  }

  return Response.json({ received: true });
}
