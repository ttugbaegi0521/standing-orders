"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * The kill switch toggle. The state comes from the server (the prop); flipping posts the wanted state and then
 * refreshes the page, so the banner and every other server-rendered part follow. Stays "busy" until the refresh lands.
 */
export function KillSwitch({ on }: { on: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const busy = saving || refreshing;

  async function flip() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: !on }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Request failed (${res.status})`);
      startRefresh(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Kill switch"
        disabled={busy}
        onClick={flip}
        className={`inline-flex items-center gap-3 rounded-md border py-1.5 pl-3.5 pr-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60 ${
          on ? "border-neg-line bg-neg-wash text-neg" : "border-rule-strong text-ink hover:bg-sunk"
        }`}
      >
        <span>Kill switch {busy ? "…" : on ? "on" : "off"}</span>
        <span
          aria-hidden
          className={`relative h-6 w-11 rounded-full transition-colors ${on ? "bg-neg" : "bg-rule-strong"}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-sm transition-all ${on ? "left-[1.375rem]" : "left-0.5"}`}
          />
        </span>
      </button>
      {error && (
        <p role="alert" className="text-xs text-neg">
          {error}
        </p>
      )}
    </div>
  );
}
