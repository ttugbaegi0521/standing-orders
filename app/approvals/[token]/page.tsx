import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getPool } from "@/lib/db";
import { LocalTime } from "../../_components/LocalTime";
import { dollars } from "../../_components/format";
import { FinalizeApproval } from "../../_components/finalize-approval";
import { Mono, Notice, OrderStatusPill, Shell, buttonPrimary, buttonQuiet } from "../../_components/ui";

interface ApprovalView {
  resolution: string | null;
  expires_at: Date;
  order_id: string;
  raw_intent: string;
  order_status: string;
  fill_status: string | null;
  capture_id: string | null;
  amount_cents: number | null;
  merchant: string | null;
  fill_error: string | null;
}

async function load(token: string): Promise<ApprovalView | null> {
  const { rows } = await getPool().query<ApprovalView>(
    `SELECT a.resolution, a.expires_at, d.order_id, o.raw_intent, o.status AS order_status,
            f.status AS fill_status, f.capture_id, f.amount_cents, f.merchant, f.error AS fill_error
       FROM approvals a
       JOIN decisions d ON d.id = a.decision_id
       JOIN standing_orders o ON o.id = d.order_id
       LEFT JOIN fills f ON f.decision_id = d.id
      WHERE a.token = $1`,
    [token],
  );
  return rows[0] ?? null;
}

/** The product title, from the candidate the agent saw at this merchant and price. */
async function productTitle(v: ApprovalView): Promise<string | null> {
  if (v.amount_cents === null || !v.merchant) return null;
  const { rows } = await getPool().query<{ title: string }>(
    `SELECT title FROM candidates WHERE order_id = $1 AND price_cents = $2 AND merchant = $3
      ORDER BY seen_at DESC LIMIT 1`,
    [v.order_id, v.amount_cents, v.merchant],
  );
  return rows[0]?.title ?? null;
}

// `params`, `searchParams` and the database are request-time, so the body streams inside a Suspense boundary.
export default function ApprovalPage({ params, searchParams }: PageProps<"/approvals/[token]">) {
  return (
    <Shell>
      <Suspense fallback={<p className="font-serif text-xl text-faint">Loading…</p>}>
        <ApprovalBody params={params} searchParams={searchParams} />
      </Suspense>
    </Shell>
  );
}

async function ApprovalBody({
  params,
  searchParams,
}: {
  params: PageProps<"/approvals/[token]">["params"];
  searchParams: PageProps<"/approvals/[token]">["searchParams"];
}) {
  await connection();
  const { token } = await params;
  const query = await searchParams;
  const cancelled = query.cancelled !== undefined;

  let view: ApprovalView | null;
  try {
    view = await load(token);
  } catch (err) {
    return <Notice tone="red">Could not read this approval: {err instanceof Error ? err.message : String(err)}</Notice>;
  }
  if (!view) notFound();

  const captured = view.fill_status === "captured";
  const title = captured ? await productTitle(view) : null;
  const backToOrder = (
    <Link href={`/orders/${view.order_id}`} className={captured ? buttonPrimary : buttonQuiet}>
      Back to the order
    </Link>
  );

  let body;
  if (captured) {
    body = (
      <>
        <p className="type-eyebrow text-muted">Purchase confirmed</p>
        <h1 className="mt-3 type-title">
          {title ?? view.raw_intent}
        </h1>
        <dl className="mt-10 grid max-w-md grid-cols-[auto_1fr] gap-x-8 gap-y-4 text-[0.95rem]">
          <dt className="text-muted">Amount</dt>
          <dd>
            <Mono>{dollars(view.amount_cents)}</Mono>
          </dd>
          <dt className="text-muted">Merchant</dt>
          <dd>{view.merchant}</dd>
          <dt className="text-muted">Capture</dt>
          <dd>
            <Mono>{view.capture_id ?? "—"}</Mono>
          </dd>
          <dt className="text-muted">Order</dt>
          <dd>
            <OrderStatusPill status={view.order_status} />
          </dd>
        </dl>
      </>
    );
  } else if (view.resolution === "rejected" || view.resolution === "expired" || view.order_status === "cancelled") {
    body = (
      <>
        <h1 className="type-title">Nothing was bought</h1>
        <p className="mt-4 max-w-prose text-muted">
          {view.order_status === "cancelled"
            ? "This standing order was cancelled, so the purchase was not completed."
            : view.resolution === "expired"
              ? "This approval expired before it was used."
              : "This approval was declined."}
        </p>
      </>
    );
  } else if (cancelled) {
    body = (
      <>
        <h1 className="type-title">You did not approve this purchase</h1>
        <p className="mt-4 max-w-prose text-muted">
          Nothing was charged. The approval stays open until <LocalTime iso={view.expires_at.toISOString()} mode="both" className="font-mono" />; you can
          still approve it from the order.
        </p>
      </>
    );
  } else {
    body = (
      <>
        <h1 className="type-title">Completing your purchase</h1>
        <p className="mb-8 mt-4 max-w-prose text-muted">PayPal has your approval. Confirming the payment now.</p>
        <FinalizeApproval token={token} />
        {view.fill_error && <p className="mt-6 text-sm text-muted">Last attempt: {view.fill_error}</p>}
      </>
    );
  }

  return (
    <>
      {body}
      <div className="mt-10">{backToOrder}</div>
    </>
  );
}
