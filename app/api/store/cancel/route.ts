// PayPal sends the buyer here if they cancel on the approval page: ?token=<paypal order id>
import { getPool } from "@/lib/db";

export async function GET(req: Request) {
  const paypalOrderId = new URL(req.url).searchParams.get("token");
  if (paypalOrderId) {
    try {
      await getPool().query(
        "UPDATE store_orders SET status = 'cancelled' WHERE paypal_order_id = $1 AND status IN ('created', 'approved')",
        [paypalOrderId],
      );
    } catch (err) {
      console.error("[store/cancel] could not mark order cancelled", err);
    }
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Checkout cancelled</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}</style>
</head><body><h1>Checkout cancelled</h1><p>You weren't charged.</p><p><a href="/store">Back to the store</a></p></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
