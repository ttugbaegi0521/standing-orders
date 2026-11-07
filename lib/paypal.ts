// Every PayPal call goes through this file. The LLM never reaches it, and the vault
// token never leaves it: callers pass a userId and this module looks the token up.
import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getPool } from "@/lib/db";

// ---- Workflow-facing client (used by workflows/standing-order/steps/execute.ts) ----

export interface PayPalOrderParams {
  amountCents: number;
  merchant: string;
  description: string;
  /** Sent as PayPal-Request-Id so retried workflow steps don't double-charge. */
  idempotencyKey: string;
  /** Tier 2: where PayPal sends the buyer after they approve / cancel. */
  returnUrl?: string;
  cancelUrl?: string;
}

export interface PayPalClient {
  /** Tier 1: create + capture against the user's vaulted payment method. */
  createAndCaptureWithVault(params: PayPalOrderParams & { userId: string }): Promise<{
    paypalOrderId: string;
    /** `pending` = PayPal is holding the capture; money has not moved yet. */
    status: "captured" | "pending" | "failed";
    captureId?: string | null;
  }>;
  /** Tier 2: create an order the user approves via a link. */
  createOrder(params: PayPalOrderParams): Promise<{ paypalOrderId: string; approveUrl: string }>;
  /** Tier 2: capture after the user approves. */
  captureOrder(
    paypalOrderId: string,
  ): Promise<{ status: "captured" | "failed"; captureId?: string | null }>;
}

function toClientStatus(status: StoreOrderStatus): "captured" | "pending" | "failed" {
  if (status === "captured") return "captured";
  return status === "approved" || status === "created" ? "pending" : "failed";
}

function appBase(): string {
  return (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function createPayPalClient(): PayPalClient {
  return {
    async createAndCaptureWithVault({ userId, amountCents, description, idempotencyKey }) {
      // The decrypted vault token lives only inside this call.
      const paymentTokenId = await loadVaultToken(userId);
      const result = await createOrderWithVaultedToken({
        amount_cents: amountCents,
        currency: "USD",
        reference_id: idempotencyKey,
        payment_token_id: paymentTokenId,
        description,
      });
      return {
        paypalOrderId: result.paypal_order_id,
        status: toClientStatus(result.status),
        captureId: result.capture_id,
      };
    },
    async createOrder({ amountCents, description, idempotencyKey, returnUrl, cancelUrl }) {
      const order = await createOrder({
        amount_cents: amountCents,
        currency: "USD",
        reference_id: idempotencyKey,
        description,
        return_url: returnUrl ?? `${appBase()}/approvals/done`,
        cancel_url: cancelUrl ?? `${appBase()}/approvals/cancelled`,
        request_id: idempotencyKey,
      });
      return { paypalOrderId: order.paypal_order_id, approveUrl: order.approve_url };
    },
    async captureOrder(paypalOrderId) {
      const result = await captureOrder(paypalOrderId);
      return {
        status: result.status === "captured" ? "captured" : "failed",
        captureId: result.capture_id,
      };
    },
  };
}

// ---- REST ----

const DEFAULT_API_BASE = "https://api-m.sandbox.paypal.com";

function apiBase(): string {
  return (process.env.PAYPAL_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
}

/** A non-2xx PayPal response (or a response we couldn't use). */
export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** PayPal's error name, e.g. UNPROCESSABLE_ENTITY or INVALID_RESOURCE_ID. */
    readonly paypalName: string | null = null,
    /** Quote this to PayPal support. */
    readonly debugId: string | null = null,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/** OAuth client-credentials token, cached in memory until one minute before it expires. */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.value;

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");

  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const body = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error_description?: string }
    | null;
  if (!res.ok || !body?.access_token || !body.expires_in) {
    throw new PayPalError(
      `PayPal token request failed: ${body?.error_description ?? res.statusText}`,
      res.status,
    );
  }
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

/** For tests. */
export function resetTokenCache(): void {
  cachedToken = null;
}

async function paypalRequest<T>(
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; requestId?: string } = {},
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.requestId && { "PayPal-Request-Id": options.requestId }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const json = (await res.json().catch(() => null)) as
    | (T & { name?: string; message?: string; debug_id?: string; details?: { issue?: string }[] })
    | null;
  if (!res.ok || json === null) {
    const issue = json?.details?.[0]?.issue;
    throw new PayPalError(
      `PayPal ${method} ${path} failed (${res.status}): ${json?.message ?? res.statusText}${issue ? ` [${issue}]` : ""}`,
      res.status,
      json?.name ?? null,
      json?.debug_id ?? null,
    );
  }
  return json;
}

export function centsToValue(cents: number): string {
  if (!Number.isInteger(cents) || cents <= 0) throw new Error(`invalid amount_cents: ${cents}`);
  return (cents / 100).toFixed(2);
}

export function valueToCents(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error(`invalid PayPal amount: ${value}`);
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

// PayPal's order and capture statuses, mapped to the status we store.
export type StoreOrderStatus = "created" | "approved" | "captured" | "cancelled" | "failed";

const ORDER_STATUS: Record<string, StoreOrderStatus> = {
  CREATED: "created",
  SAVED: "created",
  PAYER_ACTION_REQUIRED: "created",
  APPROVED: "approved",
  COMPLETED: "captured",
  VOIDED: "cancelled",
};

const CAPTURE_STATUS: Record<string, StoreOrderStatus> = {
  COMPLETED: "captured",
  // Captured but held by PayPal (e.g. review); money hasn't moved yet.
  PENDING: "approved",
  DECLINED: "failed",
  FAILED: "failed",
};

export function mapOrderStatus(status: string): StoreOrderStatus {
  return ORDER_STATUS[status] ?? "failed";
}

export function mapCaptureStatus(status: string): StoreOrderStatus {
  return CAPTURE_STATUS[status] ?? "failed";
}

interface PayPalLink {
  href: string;
  rel: string;
}

interface PayPalCapture {
  id: string;
  status: string;
  amount: { currency_code: string; value: string };
}

interface PayPalOrderResponse {
  id: string;
  status: string;
  links?: PayPalLink[];
  purchase_units?: {
    reference_id?: string;
    payments?: { captures?: PayPalCapture[] };
  }[];
}

export interface CreateOrderParams {
  amount_cents: number;
  currency: string;
  /** Our id for this purchase; PayPal echoes it back on the order. */
  reference_id: string;
  return_url: string;
  cancel_url: string;
  description?: string;
  /** PayPal-Request-Id; repeat it to make the create idempotent. */
  request_id?: string;
}

export interface CreatedOrder {
  paypal_order_id: string;
  approve_url: string;
  status: StoreOrderStatus;
}

export async function createOrder(params: CreateOrderParams): Promise<CreatedOrder> {
  const order = await paypalRequest<PayPalOrderResponse>("POST", "/v2/checkout/orders", {
    requestId: params.request_id,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: params.reference_id,
          description: params.description,
          amount: { currency_code: params.currency, value: centsToValue(params.amount_cents) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: params.return_url,
            cancel_url: params.cancel_url,
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
          },
        },
      },
    },
  });
  const approve = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve");
  if (!approve) throw new PayPalError(`PayPal order ${order.id} has no approval link`, 502);
  return { paypal_order_id: order.id, approve_url: approve.href, status: mapOrderStatus(order.status) };
}

export interface CapturedOrder {
  paypal_order_id: string;
  status: StoreOrderStatus;
  capture_id: string | null;
  amount_cents: number | null;
  currency: string | null;
}

function summarizeCapture(order: PayPalOrderResponse): CapturedOrder {
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    paypal_order_id: order.id,
    status: capture ? mapCaptureStatus(capture.status) : mapOrderStatus(order.status),
    capture_id: capture?.id ?? null,
    amount_cents: capture ? valueToCents(capture.amount.value) : null,
    currency: capture?.amount.currency_code ?? null,
  };
}

/** Captures an approved order. Idempotent: retries reuse the same PayPal-Request-Id. */
export async function captureOrder(paypal_order_id: string): Promise<CapturedOrder> {
  const order = await paypalRequest<PayPalOrderResponse>(
    "POST",
    `/v2/checkout/orders/${encodeURIComponent(paypal_order_id)}/capture`,
    { requestId: `capture-${paypal_order_id}`, body: {} },
  );
  return summarizeCapture(order);
}

export async function getOrder(paypal_order_id: string): Promise<CapturedOrder> {
  const order = await paypalRequest<PayPalOrderResponse>(
    "GET",
    `/v2/checkout/orders/${encodeURIComponent(paypal_order_id)}`,
  );
  return summarizeCapture(order);
}

const WEBHOOK_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

/**
 * Asks PayPal whether a webhook delivery is genuine. `rawBody` must be the exact request body:
 * it is spliced in unparsed, since re-serialized JSON can fail verification.
 */
export async function verifyWebhookSignature(headers: Headers, rawBody: string): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID is not set");

  const fields: Record<string, string> = { webhook_id: webhookId };
  for (const [field, header] of Object.entries(WEBHOOK_HEADERS)) {
    const value = headers.get(header);
    if (!value) return false;
    fields[field] = value;
  }
  JSON.parse(rawBody); // must be valid JSON before we splice it

  const token = await getAccessToken();
  const res = await fetch(`${apiBase()}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: `${JSON.stringify(fields).slice(0, -1)},"webhook_event":${rawBody}}`,
  });
  if (!res.ok) {
    throw new PayPalError(`PayPal webhook verification request failed (${res.status})`, res.status);
  }
  const json = (await res.json()) as { verification_status?: string };
  return json.verification_status === "SUCCESS";
}

// ---- Vault (saved PayPal payment method) ----

export interface SetupToken {
  setup_token: string;
  /** Send the user here to approve saving their PayPal as a payment method. */
  approve_url: string;
}

/** Enrollment step 1. PayPal appends `approval_token_id` (the setup token) to the return URL. */
export async function createSetupToken(params: {
  user_id: string;
  return_url?: string;
  cancel_url?: string;
}): Promise<SetupToken> {
  const res = await paypalRequest<{ id: string; links?: PayPalLink[] }>("POST", "/v3/vault/setup-tokens", {
    requestId: `setup-${params.user_id}-${randomUUID()}`,
    body: {
      customer: { merchant_customer_id: params.user_id },
      payment_source: {
        paypal: {
          usage_type: "MERCHANT",
          customer_type: "CONSUMER",
          experience_context: {
            return_url: params.return_url ?? `${appBase()}/api/users/me/vault/return`,
            cancel_url: params.cancel_url ?? `${appBase()}/`,
          },
        },
      },
    },
  });
  const approve = res.links?.find((l) => l.rel === "approve");
  if (!approve) throw new PayPalError(`PayPal setup token ${res.id} has no approval link`, 502);
  return { setup_token: res.id, approve_url: approve.href };
}

/** Enrollment step 2: the approved setup token becomes a reusable payment token id. */
export async function exchangeSetupTokenForPaymentToken(
  setup_token: string,
): Promise<{ payment_token_id: string }> {
  const res = await paypalRequest<{ id: string }>("POST", "/v3/vault/payment-tokens", {
    requestId: `exchange-${setup_token}`,
    body: { payment_source: { token: { id: setup_token, type: "SETUP_TOKEN" } } },
  });
  return { payment_token_id: res.id };
}

/** Exchanges an approved setup token and stores the payment token encrypted on the user. */
export async function enrollVaultedPaymentMethod(user_id: string, setup_token: string): Promise<void> {
  const { payment_token_id } = await exchangeSetupTokenForPaymentToken(setup_token);
  const { rowCount } = await getPool().query(
    "UPDATE users SET paypal_vault_token_enc = $2 WHERE id = $1",
    [user_id, encryptSecret(payment_token_id)],
  );
  if (!rowCount) throw new Error(`user ${user_id} not found`);
}

export async function hasVaultedPaymentMethod(user_id: string): Promise<boolean> {
  const { rows } = await getPool().query<{ enrolled: boolean }>(
    "SELECT paypal_vault_token_enc IS NOT NULL AS enrolled FROM users WHERE id = $1",
    [user_id],
  );
  return rows[0]?.enrolled ?? false;
}

/** Not exported: the decrypted token must not leave this module. */
async function loadVaultToken(user_id: string): Promise<string> {
  const { rows } = await getPool().query<{ paypal_vault_token_enc: string | null }>(
    "SELECT paypal_vault_token_enc FROM users WHERE id = $1",
    [user_id],
  );
  const enc = rows[0]?.paypal_vault_token_enc;
  if (!enc) throw new Error(`user ${user_id} has no vaulted PayPal payment method`);
  return decryptSecret(enc);
}

/**
 * Creates and captures in one call: with a vaulted payment token PayPal completes the order
 * immediately, no buyer approval. `reference_id` doubles as PayPal-Request-Id, so retries don't double-charge.
 */
export async function createOrderWithVaultedToken(params: {
  amount_cents: number;
  currency: string;
  reference_id: string;
  payment_token_id: string;
  description?: string;
}): Promise<CapturedOrder> {
  const order = await paypalRequest<PayPalOrderResponse>("POST", "/v2/checkout/orders", {
    requestId: params.reference_id,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: params.reference_id,
          description: params.description,
          amount: { currency_code: params.currency, value: centsToValue(params.amount_cents) },
        },
      ],
      payment_source: { paypal: { vault_id: params.payment_token_id } },
    },
  });
  return summarizeCapture(order);
}
