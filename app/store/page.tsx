"use client";

import Image from "next/image";
import { useState } from "react";
import { PageHeader, Shell } from "../_components/ui";
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
      <PageHeader
        title="Sandbox Store"
        description="An agent-ready merchant on the PayPal sandbox. Pay with a sandbox personal account; no real money moves."
      />
      <div className="flex flex-col gap-6">

      {error && (
        <p role="alert" className="rounded-lg border border-neg-line bg-neg-wash px-4 py-3 text-sm text-neg">
          {error}
        </p>
      )}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STORE_PRODUCTS.map((p) => (
          <li key={p.id} className="flex flex-col overflow-hidden rounded-lg border border-rule bg-panel">
            <div className="border-b border-rule bg-surface p-3">
              <Image src={p.image} alt={p.title} width={320} height={200} unoptimized className="h-auto w-full rounded-md" />
            </div>
            <div className="flex flex-1 flex-col gap-2 p-5">
              <h2 className="type-heading">{p.title}</h2>
              <p className="flex-1 text-sm leading-relaxed text-muted">{p.description}</p>
              <div className="mt-2 flex items-center justify-between gap-3 border-t border-rule pt-4">
                <span className="font-mono text-lg font-medium tabular-nums">{formatPrice(p.price_cents)}</span>
                <button
                  type="button"
                  onClick={() => buy(p.id)}
                  disabled={pending !== null}
                  className="rounded-md bg-paypal px-4 py-2 text-sm font-semibold text-ink shadow-xs transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
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
