// Enrolls the demo user's PayPal sandbox account in the Vault (if needed), then runs one $1.00 tier-1
// fill through step 5 against the real sandbox and prints the capture id.
// Needs: DATABASE_URL (migrated + seeded), PAYPAL_CLIENT_ID/SECRET, VAULT_ENCRYPTION_KEY.
// Usage: npm run vault:smoke
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { DEMO_USER, FILL_ORDER } from "@/fixtures/demo";
import { getPool } from "@/lib/db";
import { consoleNotifier } from "@/lib/notify";
import {
  createPayPalClient,
  createSetupToken,
  enrollVaultedPaymentMethod,
  hasVaultedPaymentMethod,
} from "@/lib/paypal";
import { SANDBOX_STORE_MERCHANT } from "@/workflows/standing-order/config";
import { createPgExecutePersistence, executeOrNotify } from "@/workflows/standing-order/steps/execute";

async function enrollIfNeeded() {
  if (await hasVaultedPaymentMethod(DEMO_USER.id)) {
    console.log("Demo user already has a vaulted PayPal payment method.");
    return;
  }
  const { approve_url } = await createSetupToken({ user_id: DEMO_USER.id });
  console.log(`\nOpen this URL and approve with your sandbox personal account:\n${approve_url}\n`);
  console.log("PayPal then redirects to .../api/users/me/vault/return?approval_token_id=<id>&...");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const setupToken = (await rl.question("Paste the approval_token_id from that redirect URL: ")).trim();
  rl.close();
  if (!setupToken) throw new Error("no setup token given");
  await enrollVaultedPaymentMethod(DEMO_USER.id, setupToken);
  console.log("Enrolled: payment token stored encrypted.");
}

async function main() {
  await enrollIfNeeded();

  // A fresh decision id each run, so every run is a new fill (fills are unique per decision, not per order).
  const decisionId = randomUUID();
  process.env.AGENT_READY_MERCHANTS ||= SANDBOX_STORE_MERCHANT;
  const result = await executeOrNotify(
    {
      orderId: FILL_ORDER.id,
      userId: DEMO_USER.id,
      decisionId,
      action: "fill",
      candidate: {
        productId: "vault-smoke",
        title: "Vault smoke test",
        merchant: SANDBOX_STORE_MERCHANT,
        priceCents: 100,
        url: null,
        fitScore: 100,
        mustHaves: [],
        reasoning: "smoke test",
      },
      reasoning: "Vault smoke test.",
      guardrailReasons: [],
      appBaseUrl: process.env.APP_BASE_URL || "http://localhost:3000",
      now: new Date().toISOString(),
    },
    {
      paypal: createPayPalClient(),
      notifier: consoleNotifier,
      newApprovalToken: () => randomUUID(),
      persistence: createPgExecutePersistence(),
    },
  );

  if (result.kind !== "filled" || result.fill.status !== "captured") {
    console.error("Fill did not capture:", JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(`PayPal order ${result.fill.paypalOrderId}`);
  console.log(`Capture id: ${result.fill.captureId}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
