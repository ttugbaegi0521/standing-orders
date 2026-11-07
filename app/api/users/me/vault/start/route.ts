// Starts vault enrollment: returns the PayPal URL where the user approves saving their payment method.
// "me" is the DEMO_USER_ID env var until real auth exists.
import { createSetupToken } from "@/lib/paypal";

export async function POST() {
  const userId = process.env.DEMO_USER_ID;
  if (!userId) return Response.json({ error: "DEMO_USER_ID is not set" }, { status: 500 });
  try {
    const { approve_url } = await createSetupToken({ user_id: userId });
    return Response.json({ approve_url });
  } catch (err) {
    console.error("[vault/start]", err instanceof Error ? err.message : err);
    return Response.json({ error: "Could not start PayPal vault enrollment" }, { status: 502 });
  }
}
