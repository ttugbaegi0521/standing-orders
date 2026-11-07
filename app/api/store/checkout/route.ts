import { randomUUID } from "node:crypto";
import { z } from "zod";
import { findStoreProduct } from "@/app/store/products";
import { getPool } from "@/lib/db";
import { parseBody } from "@/lib/http";
import { createOrder, PayPalError } from "@/lib/paypal";

const CheckoutBodySchema = z.object({ product_id: z.string().min(1) });

export async function POST(req: Request) {
  const body = await parseBody(req, CheckoutBodySchema);
  if (!body.ok) return body.response;

  const product = findStoreProduct(body.data.product_id);
  if (!product) return Response.json({ error: "Unknown product" }, { status: 404 });

  const id = randomUUID();
  const base = process.env.STORE_BASE_URL || new URL(req.url).origin;
  try {
    const order = await createOrder({
      amount_cents: product.price_cents,
      currency: "USD",
      reference_id: id,
      description: product.title,
      return_url: `${base}/api/store/return`,
      cancel_url: `${base}/api/store/cancel`,
      request_id: `store-${id}`,
    });
    await getPool().query(
      `INSERT INTO store_orders (id, product_id, amount_cents, paypal_order_id, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, product.id, product.price_cents, order.paypal_order_id, order.status],
    );
    return Response.json({ approve_url: order.approve_url, paypal_order_id: order.paypal_order_id });
  } catch (err) {
    console.error("[store/checkout]", err);
    const status = err instanceof PayPalError ? 502 : 500;
    return Response.json({ error: "Could not start PayPal checkout" }, { status });
  }
}
