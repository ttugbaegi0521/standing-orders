// Every PayPal call goes through this file. The LLM never reaches it, and the vault
// token never leaves it: callers pass a userId and this module looks the token up.
import { NotWiredError } from "@/lib/errors";

export interface PayPalOrderParams {
  amountCents: number;
  merchant: string;
  description: string;
  /** Sent as PayPal-Request-Id so retried workflow steps don't double-charge. */
  idempotencyKey: string;
}

export interface PayPalClient {
  /** Tier 1: create + capture against the user's vaulted payment method. */
  createAndCaptureWithVault(
    params: PayPalOrderParams & { userId: string },
  ): Promise<{ paypalOrderId: string; status: "captured" | "failed" }>;
  /** Tier 2: create an order the user approves via a link. */
  createOrder(params: PayPalOrderParams): Promise<{ paypalOrderId: string; approveUrl: string }>;
  /** Tier 2: capture after the user approves. */
  captureOrder(paypalOrderId: string): Promise<{ status: "captured" | "failed" }>;
}

export function createPayPalClient(): PayPalClient {
  // TODO(Fri/Sun): PayPal sandbox via Agent Toolkit / REST using PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET.
  return {
    async createAndCaptureWithVault() {
      throw new NotWiredError("PayPal createAndCaptureWithVault");
    },
    async createOrder() {
      throw new NotWiredError("PayPal createOrder");
    },
    async captureOrder() {
      throw new NotWiredError("PayPal captureOrder");
    },
  };
}
