// PayPal redirects the user here after they approve: ?approval_token_id=<setup token>.
// Exchanges it for a payment token and stores that encrypted on the user. Nothing secret is echoed back.
import { enrollVaultedPaymentMethod } from "@/lib/paypal";

function page(message: string, status: number): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PayPal vault</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><p>${message}</p><p><a href="/">Back</a></p></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: Request) {
  const userId = process.env.DEMO_USER_ID;
  if (!userId) return page("DEMO_USER_ID is not set.", 500);
  const setupToken = new URL(req.url).searchParams.get("approval_token_id");
  if (!setupToken) return page("PayPal did not return a setup token.", 400);
  try {
    await enrollVaultedPaymentMethod(userId, setupToken);
    return page("Your PayPal is saved. Standing orders can now buy for you at agent-ready stores.", 200);
  } catch (err) {
    console.error("[vault/return]", err instanceof Error ? err.message : err);
    return page("We could not save your PayPal. Please try again.", 502);
  }
}
