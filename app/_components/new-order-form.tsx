"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Notice, buttonPrimary, buttonQuiet, fieldClass } from "./ui";

interface Created {
  id: string;
  status: string;
  spec: { restatement: string; category: string } | null;
  warning?: string;
}

function toCents(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

export function NewOrderForm() {
  const router = useRouter();
  const [intent, setIntent] = useState("");
  const [perOrder, setPerOrder] = useState("");
  const [monthly, setMonthly] = useState("");
  const [merchants, setMerchants] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const perOrderCapCents = toCents(perOrder);
    const monthlyCapCents = toCents(monthly);
    if (intent.trim().length < 3) return setError("Say what you want to buy.");
    if (!perOrderCapCents || !monthlyCapCents) return setError("Enter both caps as dollar amounts above zero.");

    setBusy(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawIntent: intent.trim(),
          perOrderCapCents,
          monthlyCapCents,
          merchantAllowlist: merchants
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error && typeof body.error === "string" ? body.error : "Could not create the order.");
      const order = body as Created;
      // No parsed spec means there is nothing to confirm: go straight to the order, which shows the warning.
      setCreated(order);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function rejectParse() {
    if (!created) return;
    setBusy(true);
    await fetch(`/api/orders/${created.id}/cancel`, { method: "POST" }).catch(() => undefined);
    setBusy(false);
    setCreated(null);
  }

  if (created?.spec) {
    return (
      <div className="max-w-xl">
        <p className="type-eyebrow text-muted">Here is what I understood</p>
        <blockquote className="mt-4 border-l-2 border-accent pl-5 font-serif text-2xl leading-snug">
          {created.spec.restatement}
        </blockquote>
        <p className="mt-5 text-sm text-muted">
          If that is right, the order is live and will be checked on the next watch cycle. If not, cancel it and
          rephrase.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <button type="button" className={buttonPrimary} onClick={() => router.push(`/orders/${created.id}`)}>
            That is right — open the order
          </button>
          <button type="button" className={buttonQuiet} disabled={busy} onClick={rejectParse}>
            Not quite — cancel it
          </button>
        </div>
      </div>
    );
  }

  if (created) {
    return (
      <div className="max-w-xl space-y-5">
        <Notice tone="amber">
          {created.warning ?? "The order was created but could not be understood yet."}
        </Notice>
        <p className="text-sm text-muted">
          It is saved as <strong>needs review</strong> and will not be watched until its spec exists.
        </p>
        <Link href={`/orders/${created.id}`} className={buttonPrimary}>
          Open the order
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-8" noValidate>
      <div>
        <label htmlFor="intent" className="block font-serif text-xl">
          What do you want, and your max price?
        </label>
        <textarea
          id="intent"
          rows={4}
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="A good 27-inch IPS monitor for coding, under $300, free returns"
          className={`${fieldClass} mt-3 resize-y`}
          maxLength={1000}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="perOrder" className="block text-sm font-medium">
            Most to spend on one purchase
          </label>
          <div className="relative mt-2">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-faint">$</span>
            <input
              id="perOrder"
              inputMode="decimal"
              value={perOrder}
              onChange={(e) => setPerOrder(e.target.value)}
              placeholder="300"
              className={`${fieldClass} pl-8 font-mono`}
            />
          </div>
        </div>
        <div>
          <label htmlFor="monthly" className="block text-sm font-medium">
            Most to spend per month
          </label>
          <div className="relative mt-2">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-faint">$</span>
            <input
              id="monthly"
              inputMode="decimal"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              placeholder="600"
              className={`${fieldClass} pl-8 font-mono`}
            />
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="merchants" className="block text-sm font-medium">
          Merchants you trust <span className="font-normal text-faint">(optional, comma-separated)</span>
        </label>
        <input
          id="merchants"
          value={merchants}
          onChange={(e) => setMerchants(e.target.value)}
          placeholder="bestbuy.com, amazon.com"
          className={`${fieldClass} mt-2`}
        />
        <p className="mt-2 text-sm text-muted">Purchases from anywhere else always wait for your approval.</p>
      </div>

      {error && <Notice tone="red">{error}</Notice>}

      <div className="flex items-center gap-4">
        <button type="submit" disabled={busy} className={buttonPrimary}>
          {busy ? "Reading your request…" : "Create standing order"}
        </button>
        <Link href="/orders" className="text-sm text-muted hover:text-ink">
          Cancel
        </Link>
      </div>
    </form>
  );
}
