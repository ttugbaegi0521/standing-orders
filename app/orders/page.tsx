import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { demoUserId, getOrderStore, type OrderSummary } from "@/lib/orders";
import { dollars, formatWhen } from "../_components/format";
import { ActionPill, Mono, Notice, OrderStatusPill, Shell, buttonPrimary } from "../_components/ui";

async function load(): Promise<{ orders: OrderSummary[]; problem: string | null }> {
  const userId = demoUserId();
  if (!userId) return { orders: [], problem: "DEMO_USER_ID is not set, so there is no user to list orders for." };
  try {
    return { orders: await getOrderStore().listOrders(userId), problem: null };
  } catch (err) {
    return { orders: [], problem: `Could not read orders: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// The heading and button are static; the list is read from the database per request.
export default function OrdersPage() {
  return (
    <Shell width="max-w-4xl">
      <div className="flex items-end justify-between gap-4">
        <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">Your standing orders</h1>
        <Link href="/orders/new" className={`${buttonPrimary} shrink-0`}>
          New standing order
        </Link>
      </div>
      <Suspense fallback={<p className="mt-10 text-[#a3a199]">Loading your orders…</p>}>
        <OrdersList />
      </Suspense>
    </Shell>
  );
}

async function OrdersList() {
  await connection();
  const { orders, problem } = await load();

  return (
    <>
      {problem && (
        <div className="mt-8">
          <Notice tone="red">{problem}</Notice>
        </div>
      )}

      {!problem && orders.length === 0 && (
        <div className="mt-16 max-w-md">
          <p className="font-serif text-2xl">Nothing is being watched yet.</p>
          <p className="mt-3 text-[#6b6a64]">
            Describe something you want to buy and the most you will pay. The agent takes it from there.
          </p>
          <Link href="/orders/new" className={`${buttonPrimary} mt-6`}>
            Create your first order
          </Link>
        </div>
      )}

      {orders.length > 0 && (
        <div className="mt-10">
          <div className="hidden grid-cols-[1fr_6.5rem_7.5rem_7.5rem] gap-x-6 border-b border-[#e7e5df] pb-2 text-xs uppercase tracking-[0.12em] text-[#6b6a64] sm:grid">
            <span>Order</span>
            <span>Max price</span>
            <span>Status</span>
            <span>Last decision</span>
          </div>
          <ul>
            {orders.map((o) => (
              <li key={o.id} className="border-b border-[#e7e5df]">
                <Link
                  href={`/orders/${o.id}`}
                  className="grid items-center gap-x-6 gap-y-3 py-5 transition-colors hover:bg-[#f4f3ef] sm:grid-cols-[1fr_6.5rem_7.5rem_7.5rem] sm:px-0"
                >
                  <span>
                    <span className="line-clamp-2 font-serif text-lg leading-snug">{o.raw_intent}</span>
                    <span className="mt-1 block text-xs text-[#a3a199]">Created {formatWhen(o.created_at)}</span>
                  </span>
                  <span>
                    <Mono>{dollars(o.max_price_cents)}</Mono>
                  </span>
                  <span>
                    <OrderStatusPill status={o.status} />
                  </span>
                  <span>
                    <ActionPill action={o.latest_action} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
