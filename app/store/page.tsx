"use client";

import Image from "next/image";
import { useState } from "react";
import { Shell } from "../_components/ui";
import { formatPrice, STORE_PRODUCTS } from "./products";

export default function StorePage() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function buy(productId: string) {
    setPending(productId);
    setError(null);
    try {
      const res = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId }),
      });
      const body = (await res.json()) as { approve_url?: string; error?: string };
      if (!res.ok || !body.approve_url) throw new Error(body.error ?? `Checkout failed (${res.status})`);
      window.location.assign(body.approve_url);
    } catch (err) {
      setError((err as Error).message);
      setPending(null);
    }
  }

  return (
    <Shell width="max-w-4xl">
      <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="type-title">Sandbox Store</h1>
        <p className="text-muted">
          An agent-ready merchant on the PayPal sandbox. Pay with a sandbox personal account; no real money moves.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-sm border border-l-[3px] border-neg-line border-l-neg bg-neg-wash px-4 py-3 text-sm text-neg">
          {error}
        </p>
      )}

      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {STORE_PRODUCTS.map((p) => (
          <li key={p.id} className="flex flex-col overflow-hidden rounded-sm border border-rule bg-surface">
            <Image src={p.image} alt={p.title} width={320} height={200} unoptimized className="h-auto w-full" />
            <div className="flex flex-1 flex-col gap-3 p-4">
              <h2 className="type-heading">{p.title}</h2>
              <p className="flex-1 text-sm text-muted">{p.description}</p>
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-lg tabular-nums">{formatPrice(p.price_cents)}</span>
                <button
                  type="button"
                  onClick={() => buy(p.id)}
                  disabled={pending !== null}
                  className="rounded-md bg-paypal px-4 py-2 text-sm font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {pending === p.id ? "Redirecting…" : "Buy with PayPal"}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      </div>
    </Shell>
  );
}
