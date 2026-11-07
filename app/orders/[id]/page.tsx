import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getPool } from "@/lib/db";
import { demoUserId, getOrderStore, UUID_RE, type OrderDetail } from "@/lib/orders";
import { getPriceHistory } from "@/lib/price-history";
import type { PricePoint } from "@/lib/schemas";
import { CheckNowButton } from "../../_components/CheckNowButton";
import { LocalTime } from "../../_components/LocalTime";
import { PriceChart } from "../../_components/PriceChart";
import { dollars } from "../../_components/format";
import { OrderActions } from "../../_components/order-actions";
import { ActionPill, Mono, Notice, OrderStatusPill, SectionTitle, Shell, buttonPrimary } from "../../_components/ui";

interface CandidateRow {
  channel3_product_id: string;
  merchant: string;
  title: string;
  url: string | null;
  price_cents: number;
  fit_score: number;
  fit_reasoning: string;
  must_haves: { requirement: string; pass: boolean }[] | null;
  seen_at: string;
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-[#a3a199]">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-[0.95rem]">
          <span aria-hidden className="mt-[0.62em] h-px w-3 shrink-0 bg-[#a3a199]" />
          {item}
        </li>
      ))}
    </ul>
  );
}

/** "Kill switch is on: ..." reads better mid-sentence as "kill switch is on: ...". */
function inSentence(reason: string): string {
  const r = reason.replace(/[.\s]+$/, "");
  return /^[A-Z][a-z]/.test(r) ? r[0].toLowerCase() + r.slice(1) : r;
}

function Decision({ d }: { d: OrderDetail["decisions"][number] }) {
  const changed = d.model_action !== d.action;
  const because = d.guardrail_reasons.filter(Boolean).map(inSentence).join("; ");
  return (
    <li className="border-t border-[#e7e5df] py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ActionPill action={d.action} />
        <LocalTime iso={d.created_at} mode="both" className="font-mono text-xs tabular-nums text-[#6b6a64]" />
      </div>
      {changed ? (
        <p className="mt-2 text-sm text-[#3a3935]">
          Claude proposed <strong>{d.model_action}</strong> → guardrails changed it to <strong>{d.action}</strong>
          {because ? ` because ${because}.` : "."}
        </p>
      ) : (
        because && <p className="mt-2 text-sm text-[#6b6a64]">Guardrail note: {because}.</p>
      )}
      <p className="mt-2 max-w-prose text-[0.95rem] leading-relaxed">{d.reasoning}</p>
    </li>
  );
}

// `params` and the database are request-time, so the page body streams inside a Suspense boundary.
export default function OrderPage({ params }: PageProps<"/orders/[id]">) {
  return (
    <Shell>
      <Suspense fallback={<p className="text-[#a3a199]">Loading order…</p>}>
        <OrderBody params={params} />
      </Suspense>
    </Shell>
  );
}

async function OrderBody({ params }: { params: PageProps<"/orders/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const userId = demoUserId();
  if (!UUID_RE.test(id)) notFound();

  let detail: OrderDetail | null = null;
  let problem: string | null = null;
  if (!userId) problem = "DEMO_USER_ID is not set.";
  else {
    try {
      detail = await getOrderStore().getOrderDetail(id, userId);
    } catch (err) {
      problem = `Could not read this order: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (problem) return <Notice tone="red">{problem}</Notice>;
  if (!detail) notFound();

  const { order, decisions, open_approvals: approvals, fills } = detail;
  const spec = order.spec;
  const candidate = detail.latest_candidate as CandidateRow | null;

  // History for the product the agent is currently looking at. Any failure just shows the chart's empty state.
  let history: PricePoint[] = [];
  if (candidate) {
    try {
      history = await getPriceHistory(getPool(), candidate.channel3_product_id);
    } catch (err) {
      console.error("[orders/[id]] could not load price history:", (err as Error).message);
    }
  }

  return (
    <>
      <Link href="/orders" className="text-sm text-[#6b6a64] hover:text-[#1c1b19]">
        ← All orders
      </Link>

      <header className="mb-12 mt-6">
        <div className="flex flex-wrap items-center gap-3">
          <OrderStatusPill status={order.status} />
          <Mono className="text-xs text-[#a3a199]">{order.id}</Mono>
        </div>
        <h1 className="mt-4 font-serif text-3xl leading-tight tracking-tight sm:text-4xl">{order.raw_intent}</h1>
      </header>

      {order.status === "needs_review" && (
        <div className="mb-10">
          <Notice tone="amber">
            This order has no parsed spec yet, so it is not being watched. Cancel it and create a new one with
            clearer wording.
          </Notice>
        </div>
      )}

      <div className="mb-14 flex flex-wrap items-center gap-3">
        <CheckNowButton orderId={order.id} disabled={order.status !== "active" && order.status !== "needs_review"} />
        <OrderActions orderId={order.id} status={order.status} />
      </div>

      {approvals.length > 0 && (
        <section className="mb-14 rounded-xl border border-[#c9d2f6] bg-[#eef1fd] p-6">
          <SectionTitle>Waiting for you</SectionTitle>
          {approvals.map((a) => (
            <div key={a.token}>
              <p className="max-w-prose">
                The agent found a match and needs your OK before buying. Approve on PayPal; you will land back here
                once it is captured.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
                {a.approve_url && (
                  <a href={a.approve_url} className={buttonPrimary}>
                    Approve purchase
                  </a>
                )}
                <span className="text-sm text-[#5b6aa8]">
                  Expires <LocalTime iso={a.expires_at} mode="both" />
                </span>
              </div>
            </div>
          ))}
        </section>
      )}

      {fills.length > 0 && (
        <section className="mb-14">
          <SectionTitle>Purchases</SectionTitle>
          <ul className="space-y-4">
            {fills.map((f, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-[#e7e5df] pt-4 first:border-t-0 first:pt-0">
                <Mono className="text-lg">{dollars(f.amount_cents)}</Mono>
                <span>{f.merchant}</span>
                <span className="text-sm capitalize text-[#6b6a64]">{f.status}</span>
                {f.capture_id && (
                  <span className="text-sm text-[#6b6a64]">
                    Capture <Mono>{f.capture_id}</Mono>
                  </span>
                )}
                {f.error && <span className="w-full text-sm text-red-800">{f.error}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-14">
        <SectionTitle>What the agent understood</SectionTitle>
        {spec ? (
          <div className="space-y-8">
            <blockquote className="border-l-2 border-[#2748d4] pl-5 font-serif text-xl leading-snug">
              {spec.restatement}
            </blockquote>
            <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
              <div>
                <dt className="mb-2 text-sm font-medium">Category</dt>
                <dd className="text-[0.95rem]">{spec.category}</dd>
              </div>
              <div>
                <dt className="mb-2 text-sm font-medium">Max price</dt>
                <dd>
                  <Mono>{dollars(order.max_price_cents ?? spec.maxPriceCents)}</Mono>
                </dd>
              </div>
              <div>
                <dt className="mb-2 text-sm font-medium">Must have</dt>
                <dd>
                  <List items={spec.mustHaves} empty="Nothing required" />
                </dd>
              </div>
              <div>
                <dt className="mb-2 text-sm font-medium">Nice to have</dt>
                <dd>
                  <List items={spec.niceToHaves} empty="None" />
                </dd>
              </div>
              <div>
                <dt className="mb-2 text-sm font-medium">Your limits</dt>
                <dd className="space-y-1 text-[0.95rem]">
                  <p>
                    <Mono>{dollars(order.per_order_cap_cents)}</Mono> per purchase
                  </p>
                  <p>
                    <Mono>{dollars(order.monthly_cap_cents)}</Mono> per month
                  </p>
                </dd>
              </div>
              <div>
                <dt className="mb-2 text-sm font-medium">Trusted merchants</dt>
                <dd>
                  <List items={order.merchant_allowlist} empty="None, so every purchase asks you first" />
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="text-[#6b6a64]">Not parsed yet.</p>
        )}
      </section>

      <section className="mb-14">
        <SectionTitle>Current candidate</SectionTitle>
        {candidate ? (
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <h3 className="font-serif text-xl leading-snug">
                {candidate.url ? (
                  <a href={candidate.url} className="underline decoration-[#d6d4cc] underline-offset-4 hover:decoration-[#2748d4]">
                    {candidate.title}
                  </a>
                ) : (
                  candidate.title
                )}
              </h3>
              <Mono className="text-lg">{dollars(candidate.price_cents)}</Mono>
            </div>
            <p className="mt-2 text-sm text-[#6b6a64]">
              {candidate.merchant} · fit <Mono>{candidate.fit_score}</Mono>/100 · seen{" "}
              <LocalTime iso={candidate.seen_at} mode="both" />
            </p>
            <p className="mt-3 max-w-prose text-[0.95rem] leading-relaxed">{candidate.fit_reasoning}</p>
            {candidate.must_haves && candidate.must_haves.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {candidate.must_haves.map((m) => (
                  <li key={m.requirement} className={m.pass ? "text-[#3a3935]" : "text-red-800"}>
                    <span aria-label={m.pass ? "met" : "not met"}>{m.pass ? "✓" : "✗"}</span> {m.requirement}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-[#6b6a64]">No candidate yet. One appears after the first check.</p>
        )}
      </section>

      <section className="mb-14">
        <SectionTitle>Price history</SectionTitle>
        <PriceChart points={history} maxPriceCents={order.max_price_cents ?? spec?.maxPriceCents ?? null} />
      </section>

      <section>
        <SectionTitle>Decision log</SectionTitle>
        {decisions.length === 0 ? (
          <p className="text-[#6b6a64]">No checks yet. Use “Check now”, or wait for the next watch cycle.</p>
        ) : (
          <ol>
            {decisions.map((d) => (
              <Decision key={d.id} d={d} />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
