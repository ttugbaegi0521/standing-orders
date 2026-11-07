"use client";

import Image from "next/image";
import { useState } from "react";
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
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Sandbox Store</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          An agent-ready merchant on the PayPal sandbox. Pay with a sandbox personal account; no real money moves.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {STORE_PRODUCTS.map((p) => (
          <li key={p.id} className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <Image src={p.image} alt={p.title} width={320} height={200} unoptimized className="h-auto w-full" />
            <div className="flex flex-1 flex-col gap-3 p-4">
              <h2 className="font-medium">{p.title}</h2>
              <p className="flex-1 text-sm text-zinc-600 dark:text-zinc-400">{p.description}</p>
              <div className="flex items-center justify-between gap-3">
                <span className="text-lg font-semibold">{formatPrice(p.price_cents)}</span>
                <button
                  type="button"
                  onClick={() => buy(p.id)}
                  disabled={pending !== null}
                  className="rounded-full bg-[#ffc439] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {pending === p.id ? "Redirecting…" : "Buy with PayPal"}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
