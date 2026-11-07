// PayPal redirects the buyer here after they approve: ?token=<paypal order id>&PayerID=...
import { findStoreProduct, formatPrice } from "@/app/store/products";
import { getPool } from "@/lib/db";
import { captureOrder, PayPalError } from "@/lib/paypal";

interface StoreOrderRow {
  id: string;
  product_id: string;
  amount_cents: number;
  paypal_order_id: string;
  capture_id: string | null;
  status: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(title: string, rows: [string, string][], status = 200): Response {
  const items = rows
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`)
    .join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}
dl{display:grid;grid-template-columns:auto 1fr;gap:.25rem 1rem}dt{color:#666}dd{margin:0;font-family:ui-monospace,monospace}</style>
</head><body><h1>${escapeHtml(title)}</h1><dl>${items}</dl><p><a href="/store">Back to the store</a></p></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: Request) {
  const paypalOrderId = new URL(req.url).searchParams.get("token");
  if (!paypalOrderId) return page("Missing order", [["Error", "PayPal did not return an order token."]], 400);

  const db = getPool();
  const { rows } = await db.query<StoreOrderRow>("SELECT * FROM store_orders WHERE paypal_order_id = $1", [
    paypalOrderId,
  ]);
  const row = rows[0];
  if (!row) return page("Unknown order", [["PayPal order", paypalOrderId]], 404);

  const product = findStoreProduct(row.product_id)?.title ?? row.product_id;

  // Refreshing the page must not capture twice.
  if (row.status === "captured" && row.capture_id) {
    return page("Payment complete", [
      ["Product", product],
      ["Amount", formatPrice(row.amount_cents)],
      ["Capture ID", row.capture_id],
      ["PayPal order", paypalOrderId],
    ]);
  }

  try {
    const capture = await captureOrder(paypalOrderId);
    await db.query(
      `UPDATE store_orders
       SET status = $2, capture_id = $3,
           captured_at = CASE WHEN $2 = 'captured' THEN coalesce(captured_at, now()) ELSE captured_at END
       WHERE paypal_order_id = $1`,
      [paypalOrderId, capture.status, capture.capture_id],
    );
    if (capture.status !== "captured" || !capture.capture_id) {
      return page("Payment not completed", [
        ["Status", capture.status],
        ["PayPal order", paypalOrderId],
      ], 502);
    }
    return page("Payment complete", [
      ["Product", product],
      ["Amount", formatPrice(capture.amount_cents ?? row.amount_cents)],
      ["Capture ID", capture.capture_id],
      ["PayPal order", paypalOrderId],
    ]);
  } catch (err) {
    console.error("[store/return] capture failed", err);
    await db.query("UPDATE store_orders SET status = 'failed' WHERE paypal_order_id = $1 AND status <> 'captured'", [
      paypalOrderId,
    ]);
    const debugId = err instanceof PayPalError && err.debugId ? err.debugId : "n/a";
    return page("Payment failed", [
      ["PayPal order", paypalOrderId],
      ["PayPal debug ID", debugId],
    ], 502);
  }
}
