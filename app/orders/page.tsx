import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getPool } from "@/lib/db";
import { demoUserId, getKillSwitch, getOrderStore, type OrderSummary } from "@/lib/orders";
import { KillSwitch } from "../_components/KillSwitch";
import { LocalTime } from "../_components/LocalTime";
import { dollars } from "../_components/format";
import { ActionPill, Mono, Notice, OrderStatusPill, PageHeader, Shell, buttonPrimary } from "../_components/ui";

async function load(): Promise<{ orders: OrderSummary[]; problem: string | null }> {
  const userId = demoUserId();
  if (!userId) return { orders: [], problem: "DEMO_USER_ID is not set, so there is no user to list orders for." };
  try {
    return { orders: await getOrderStore().listOrders(userId), problem: null };
  } catch (err) {
    return { orders: [], problem: `Could not read orders: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Watching first, then orders that need attention, then finished ones. Nothing is hidden, only ranked.
const RANK: Record<string, number> = { active: 0, needs_review: 1, filled: 2, paused: 3, cancelled: 4 };
const COUNT_LABEL: Record<string, string> = {
  active: "watching",
  needs_review: "needs review",
  filled: "filled",
  paused: "paused",
  cancelled: "cancelled",
};
/** Finished orders are muted so attention goes to the ones still being watched. */
const MUTED = new Set(["filled", "cancelled"]);

function rankOrders(orders: OrderSummary[]): OrderSummary[] {
  // Array.prototype.sort is stable, so within a rank the store's newest-first order is kept.
  return [...orders].sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9));
}

function counts(orders: OrderSummary[]): string {
  const n: Record<string, number> = {};
  for (const o of orders) n[o.status] = (n[o.status] ?? 0) + 1;
  return Object.keys(RANK)
    .filter((s) => n[s])
    .map((s) => `${n[s]} ${COUNT_LABEL[s]}`)
    .join(" · ");
}

/** null when it can't be read (no user, or the database is down); the orders list reports that problem itself. */
async function killSwitchState(): Promise<boolean | null> {
  const userId = demoUserId();
  if (!userId) return null;
  try {
    return await getKillSwitch(getPool(), userId);
  } catch {
    return null;
  }
}

async function KillSwitchBanner() {
  await connection();
  if (!(await killSwitchState())) return null;
  return (
    <div role="alert" className="mb-6 rounded-lg bg-neg px-5 py-3.5 text-[0.9375rem] font-medium text-paper">
      Agent paused — kill switch on. No purchases will be made.
    </div>
  );
}

async function KillSwitchControl() {
  await connection();
  const on = await killSwitchState();
  return on === null ? null : <KillSwitch on={on} />;
}

// The heading and buttons are static; the kill switch and the list are read from the database per request.
export default function OrdersPage() {
  return (
    <Shell width="max-w-4xl">
      <Suspense fallback={null}>
        <KillSwitchBanner />
      </Suspense>
      <PageHeader
        title="Your standing orders"
        actions={
          <>
            <Suspense fallback={null}>
              <KillSwitchControl />
            </Suspense>
            <Link href="/orders/new" className={`${buttonPrimary} shrink-0`}>
              New standing order
            </Link>
          </>
        }
      />
      <Suspense fallback={<p className="text-sm text-muted">Loading your orders…</p>}>
        <OrdersList />
      </Suspense>
    </Shell>
  );
}

async function OrdersList() {
  await connection();
  const { orders: unranked, problem } = await load();
  const orders = rankOrders(unranked);

  return (
    <>
      {problem && (
        <Notice tone="red">{problem}</Notice>
      )}

      {!problem && orders.length === 0 && (
        <div className="rounded-lg border border-dashed border-rule-strong bg-panel px-6 py-12 text-center">
          <p className="type-heading">Nothing is being watched yet.</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted">
            Describe something you want to buy and the most you will pay. The agent takes it from there.
          </p>
          <Link href="/orders/new" className={`${buttonPrimary} mt-6`}>
            Create your first order
          </Link>
        </div>
      )}

      {orders.length > 0 && (
        <div>
          <p className="mb-3 text-sm text-muted">{counts(orders)}</p>
          <div className="overflow-hidden rounded-lg border border-rule bg-surface">
            <div className="hidden grid-cols-[1fr_6.5rem_7.5rem_7.5rem] gap-x-6 border-b border-rule bg-panel px-5 py-2.5 type-eyebrow text-muted sm:grid">
              <span>Order</span>
              <span>Max price</span>
              <span>Status</span>
              <span>Last decision</span>
            </div>
            <ul>
              {orders.map((o) => {
                const muted = MUTED.has(o.status);
                return (
                  <li key={o.id} className="border-t border-rule first:border-t-0">
                    <Link
                      href={`/orders/${o.id}`}
                      className={`grid items-center gap-x-6 gap-y-2.5 px-5 py-4 transition-colors hover:bg-panel focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:grid-cols-[1fr_6.5rem_7.5rem_7.5rem] ${
                        muted ? "text-muted" : ""
                      }`}
                    >
                      <span>
                        <span className={`line-clamp-2 text-[0.9375rem] font-medium leading-snug ${muted ? "" : "text-ink"}`}>
                          {o.raw_intent}
                        </span>
                        <span className="mt-1 block text-xs text-muted">
                          Created <LocalTime iso={o.created_at} mode="relative" />
                        </span>
                      </span>
                      <span>
                        <Mono className="text-sm">{dollars(o.max_price_cents)}</Mono>
                      </span>
                      <span>
                        <OrderStatusPill status={o.status} />
                      </span>
                      <span>
                        <ActionPill action={o.latest_action} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
