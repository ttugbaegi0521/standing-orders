import { notImplemented } from "@/lib/http";

export async function POST() {
  // TODO: verify PayPal webhook signature, update fills.status on capture events.
  return notImplemented("POST /api/webhooks/paypal");
}
