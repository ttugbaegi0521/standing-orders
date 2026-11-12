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
import { PipelineStrip } from "../../_components/PipelineStrip";
import { PriceChart } from "../../_components/PriceChart";
import { dollars } from "../../_components/format";
import { OrderActions } from "../../_components/order-actions";
import { analyzePriceHistory, type PriceSignals } from "@/workflows/standing-order/price-signals";
import { KILL_SWITCH_REASON } from "@/workflows/standing-order/steps/guardrails";
import { ActionPill, Card, Mono, Notice, OrderStatusPill, PageHeader, Pill, Shell, buttonPrimary } from "../../_components/ui";

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
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-sm text-ink-2">
          <span aria-hidden className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-faint" />
          {item}
        </li>
      ))}
    </ul>
  );
}

/** "Kill switch is on: ..." reads better mid-sentence as "kill switch is on: ...". */
function inSentence(reason: string): string {
  if (reason === KILL_SWITCH_REASON) return "the kill switch is on";
  const r = reason.replace(/[.\s]+$/, "");
  return /^[A-Z][a-z]/.test(r) ? r[0].toLowerCase() + r.slice(1) : r;
}

function Decision({ d }: { d: OrderDetail["decisions"][number] }) {
  const changed = d.model_action !== d.action;
  const because = d.guardrail_reasons.filter(Boolean).map(inSentence).join("; ");
  const killSwitch = d.guardrail_reasons.includes(KILL_SWITCH_REASON);
  return (
    <li className="border-t border-rule px-5 py-4 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ActionPill action={d.action} />
        <LocalTime iso={d.created_at} mode="both" className="font-mono text-xs tabular-nums text-muted" />
      </div>
      {changed ? (
        <p className="mt-2 text-sm text-warn">
          Claude proposed <strong>{d.model_action}</strong> → guardrails changed it to <strong>{d.action}</strong>
          {because ? ` because ${because}.` : "."}
        </p>
      ) : (
        because && <p className="mt-2 text-sm text-muted">Guardrail note: {because}.</p>
      )}
      {killSwitch && (
        <p className="mt-2 rounded-md border border-neg-line bg-neg-wash px-3 py-2 text-sm font-medium text-neg">
          Blocked by the kill switch. No purchase was made.
        </p>
      )}
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-2">{d.reasoning}</p>
    </li>
  );
}

/** "Oct 30": the day only, in UTC so it reads the same wherever the page is rendered. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "4LS4…835J"; the full id is in the title and in the purchases list below. */
function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

/**
 * The fake-sale signals behind the latest decision, or null when it was not a fake-sale refusal. The signals are
 * not stored with the decision, so they are recomputed with the same pure function the decide step used, over the
 * history as it stood when the decision was made.
 */
function fakeSaleRefusal(
  latest: OrderDetail["decisions"][number] | undefined,
  candidate: CandidateRow | null,
  history: PricePoint[],
): PriceSignals | null {
  if (!latest || !candidate || latest.action !== "skip" || latest.model_action !== "skip") return null;
  const signals = analyzePriceHistory(history, candidate.price_cents, new Date(latest.created_at).toISOString());
  return signals.fakeSale.detected ? signals : null;
}

function RefusalCallout({ signals }: { signals: PriceSignals }) {
  const { inflatedPeakCents, inflatedAt, claimedDiscountPct } = signals.fakeSale;
  return (
    <section role="status" aria-label="Refused: fake sale" className="overflow-hidden rounded-lg border border-neg-line bg-neg-wash">
      <div className="px-5 pb-4 pt-5">
        <p className="type-eyebrow text-neg">Not bought</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-neg">Refused — fake sale</h2>
        <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed text-ink">
          “Discount” measured from a price raised to <Mono className="font-medium">{dollars(inflatedPeakCents)}</Mono>
          {inflatedAt ? ` on ${shortDate(inflatedAt)}` : ""}.
        </p>
      </div>
      <dl className="grid grid-cols-1 border-t border-neg-line bg-surface text-ink sm:grid-cols-3">
        <div className="px-5 py-3">
          <dt className="type-eyebrow text-muted">Usual price</dt>
          <dd className="mt-1 text-lg">
            <Mono>{dollars(signals.baselineCents)}</Mono>
          </dd>
        </div>
        <div className="border-t border-rule px-5 py-3 sm:border-l sm:border-t-0">
          <dt className="type-eyebrow text-muted">Raised to</dt>
          <dd className="mt-1 text-lg">
            <Mono className="text-neg">{dollars(inflatedPeakCents)}</Mono>
          </dd>
        </div>
        <div className="border-t border-rule px-5 py-3 sm:border-l sm:border-t-0">
          <dt className="type-eyebrow text-muted">“Sale” price now</dt>
          <dd className="mt-1 text-lg">
            <Mono>{dollars(signals.currentPriceCents)}</Mono>
            {claimedDiscountPct !== null && (
              <span className="ml-2 text-xs text-muted">advertised as {Math.round(claimedDiscountPct * 100)}% off</span>
            )}
          </dd>
        </div>
      </dl>
      <div className="border-t border-neg-line px-5 py-3">
        <a href="#price-history" className="text-sm font-medium text-neg underline-offset-4 hover:underline">
          See it in the price history ↓
        </a>
      </div>
    </section>
  );
}

function FilledBanner({ fill }: { fill: OrderDetail["fills"][number] }) {
  return (
    <section role="status" className="flex items-center gap-3 rounded-lg border border-pos-line bg-pos-wash px-5 py-4 text-ink">
      <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-pos text-sm font-semibold text-paper">
        ✓
      </span>
      <p className="text-[0.9375rem] font-semibold sm:text-base">
        Bought for <Mono className="text-pos">{dollars(fill.amount_cents)}</Mono> via PayPal
        {fill.capture_id && (
          <>
            {" "}
            <span className="text-sm font-normal text-muted">
              · capture{" "}
              <span title={fill.capture_id}>
                <Mono>{shortId(fill.capture_id)}</Mono>
              </span>
            </span>
          </>
        )}
      </p>
    </section>
  );
}

// `params` and the database are request-time, so the page body streams inside a Suspense boundary.
export default function OrderPage({ params }: PageProps<"/orders/[id]">) {
  return (
    <Shell width="max-w-4xl">
      <Suspense fallback={<p className="text-sm text-muted">Loading order…</p>}>
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

  const refusal = fakeSaleRefusal(decisions[0], candidate, history);
  const boughtFill = order.status === "filled" ? (fills.find((f) => f.status === "captured") ?? null) : null;

  return (
    <>
      <Link
        href="/orders"
        className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        ← All orders
      </Link>

      <div className="mt-5">
        <PageHeader
          meta={
            <>
              <OrderStatusPill status={order.status} />
              <Mono className="break-all text-xs text-muted">{order.id}</Mono>
            </>
          }
          title={order.raw_intent}
        />
      </div>

      <div className="flex flex-col gap-6">
        {order.status === "needs_review" && (
          <Notice tone="amber">
            This order has no parsed spec yet, so it is not being watched. Cancel it and create a new one with
            clearer wording.
          </Notice>
        )}

        <Card title="Latest agent cycle" bodyClassName="px-5 pb-4 pt-4">
          <PipelineStrip
            hasSpec={spec !== null}
            consideredCount={Math.max(detail.considered.length, candidate ? 1 : 0)}
            decision={decisions[0] ?? null}
            filled={order.status === "filled" || fills.some((f) => f.status === "captured")}
            approvalOpen={approvals.length > 0}
          />
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-rule pt-4">
            <CheckNowButton orderId={order.id} disabled={order.status !== "active" && order.status !== "needs_review"} />
            <OrderActions orderId={order.id} status={order.status} />
          </div>
        </Card>

        {boughtFill && <FilledBanner fill={boughtFill} />}
        {refusal && <RefusalCallout signals={refusal} />}

        {approvals.length > 0 && (
          <section className="rounded-lg border border-accent-line bg-accent-wash px-5 py-5">
            <h2 className="type-eyebrow mb-2 text-accent">Waiting for you</h2>
            {approvals.map((a) => (
              <div key={a.token}>
                <p className="max-w-prose text-[0.9375rem] text-ink-2">
                  The agent found a match and needs your OK before buying. Approve on PayPal; you will land back here
                  once it is captured.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
                  {a.approve_url && (
                    <a href={a.approve_url} className={buttonPrimary}>
                      Approve purchase
                    </a>
                  )}
                  <span className="text-sm text-muted">
                    Expires <LocalTime iso={a.expires_at} mode="both" />
                  </span>
                </div>
              </div>
            ))}
          </section>
        )}

        {fills.length > 0 && (
          <Card title="Purchases" bodyClassName="">
            <ul>
              {fills.map((f, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-rule px-5 py-3 first:border-t-0">
                  <Mono className="text-base font-medium">{dollars(f.amount_cents)}</Mono>
                  <span className="text-sm">{f.merchant}</span>
                  <span className="text-sm capitalize text-muted">{f.status}</span>
                  {f.capture_id && (
                    <span className="text-sm text-muted">
                      Capture <Mono className="break-all">{f.capture_id}</Mono>
                    </span>
                  )}
                  {f.error && <span className="w-full text-sm text-neg">{f.error}</span>}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="What the agent understood">
          {spec ? (
            <div className="space-y-5">
              <blockquote className="border-l-2 border-accent pl-4 type-heading text-ink">{spec.restatement}</blockquote>
              <dl className="grid gap-px overflow-hidden rounded-md border border-rule bg-rule sm:grid-cols-2">
                <div className="bg-surface px-4 py-3">
                  <dt className="type-eyebrow mb-1.5 text-muted">Category</dt>
                  <dd className="text-sm text-ink">{spec.category}</dd>
                </div>
                <div className="bg-surface px-4 py-3">
                  <dt className="type-eyebrow mb-1.5 text-muted">Max price</dt>
                  <dd>
                    <Mono className="text-sm font-medium">{dollars(order.max_price_cents ?? spec.maxPriceCents)}</Mono>
                  </dd>
                </div>
                <div className="bg-surface px-4 py-3">
                  <dt className="type-eyebrow mb-1.5 text-muted">Must have</dt>
                  <dd>
                    <List items={spec.mustHaves} empty="Nothing required" />
                  </dd>
                </div>
                <div className="bg-surface px-4 py-3">
                  <dt className="type-eyebrow mb-1.5 text-muted">Nice to have</dt>
                  <dd>
                    <List items={spec.niceToHaves} empty="None" />
                  </dd>
                </div>
                <div className="bg-surface px-4 py-3">
                  <dt className="type-eyebrow mb-1.5 text-muted">Your limits</dt>
                  <dd className="space-y-0.5 text-sm text-ink-2">
                    <p>
                      <Mono className="font-medium text-ink">{dollars(order.per_order_cap_cents)}</Mono> per purchase
                    </p>
                    <p>
                      <Mono className="font-medium text-ink">{dollars(order.monthly_cap_cents)}</Mono> per month
                    </p>
                  </dd>
                </div>
                <div className="bg-surface px-4 py-3">
                  <dt className="type-eyebrow mb-1.5 text-muted">Trusted merchants</dt>
                  <dd>
                    <List items={order.merchant_allowlist} empty="None, so every purchase asks you first" />
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="text-sm text-muted">Not parsed yet.</p>
          )}
        </Card>

        <Card title="Current candidate" aside="via Channel3">
          {candidate ? (
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <h3 className="min-w-0 type-heading">
                  {candidate.url ? (
                    <a
                      href={candidate.url}
                      className="underline decoration-rule-strong underline-offset-4 transition-colors hover:decoration-ink"
                    >
                      {candidate.title}
                    </a>
                  ) : (
                    candidate.title
                  )}
                </h3>
                <Mono className="text-lg font-semibold">{dollars(candidate.price_cents)}</Mono>
              </div>
              <p className="mt-1.5 text-sm text-muted">
                {candidate.merchant} · fit <Mono className="text-ink">{candidate.fit_score}</Mono>/100 · seen{" "}
                <LocalTime iso={candidate.seen_at} mode="both" />
              </p>
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-2">{candidate.fit_reasoning}</p>
              {candidate.must_haves && candidate.must_haves.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-2 border-t border-rule pt-4 text-sm">
                  {candidate.must_haves.map((m) => (
                    <li
                      key={m.requirement}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 ${
                        m.pass ? "border-rule bg-surface text-ink-2" : "border-neg-line bg-neg-wash text-neg"
                      }`}
                    >
                      <span aria-label={m.pass ? "met" : "not met"} className={m.pass ? "text-pos" : "text-neg"}>
                        {m.pass ? "✓" : "✗"}
                      </span>{" "}
                      {m.requirement}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">No candidate yet. One appears after the first check.</p>
          )}
        </Card>

        {detail.considered.length > 1 && (
          <Card
            title={`Considered ${detail.considered.length} products via Channel3`}
            aside={`The top ${detail.considered.length} by fit score from the latest check.`}
            bodyClassName="bg-surface"
          >
            <ul>
              {detail.considered.map((c) => (
                <li
                  key={c.channel3_product_id}
                  className={`grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1 border-t border-rule px-5 py-3 text-sm first:border-t-0 sm:grid-cols-[1fr_auto_5.5rem_4.5rem] ${
                    c.chosen ? "bg-accent-wash/50" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span className={`block truncate ${c.chosen ? "font-semibold text-ink" : "text-ink"}`}>
                      {c.url ? (
                        <a href={c.url} className="hover:underline">
                          {c.title}
                        </a>
                      ) : (
                        c.title
                      )}
                    </span>
                    <span className="text-xs text-muted">{c.merchant}</span>
                  </span>
                  <span className="justify-self-end sm:order-last">{c.chosen && <Pill tone="blue">Chosen</Pill>}</span>
                  <span className="text-right sm:text-left">
                    <Mono className="font-medium">{dollars(c.price_cents)}</Mono>
                  </span>
                  <span className="text-muted">
                    fit <Mono className="text-ink">{c.fit_score}</Mono>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card id="price-history" className="scroll-mt-20" title="Price history">
          <PriceChart points={history} maxPriceCents={order.max_price_cents ?? spec?.maxPriceCents ?? null} />
        </Card>

        <Card title="Decision log" bodyClassName={decisions.length === 0 ? "p-5" : ""}>
          {decisions.length === 0 ? (
            <p className="text-sm text-muted">No checks yet. Use “Check now”, or wait for the next watch cycle.</p>
          ) : (
            <ol>
              {decisions.map((d) => (
                <Decision key={d.id} d={d} />
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
