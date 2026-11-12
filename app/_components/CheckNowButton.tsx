"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Notice, buttonPrimary } from "./ui";

interface CheckSummary {
  action: string;
  reasoning: string;
  error?: string;
}

function friendly(status: number, serverMessage: unknown): string {
  const message = typeof serverMessage === "string" ? serverMessage : "";
  if (status === 409) {
    const state = /that is (\w+)/.exec(message)?.[1];
    return state ? `${state[0].toUpperCase()}${state.slice(1)} orders aren’t checked.` : "This order can’t be checked right now.";
  }
  if (status === 503) return "Live keys not configured: set ANTHROPIC_API_KEY and CHANNEL3_API_KEY.";
  return message || `The check failed (${status}).`;
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="mr-2.5 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

/**
 * Runs one live check. The pending state lasts for the whole request (a live check can take a minute) and on
 * through the page refresh, so the new decision, candidate and price point appear before the button comes back.
 * Rendered as a fragment so it sits in the same row as the other order controls.
 */
export function CheckNowButton({ orderId, disabled = false }: { orderId: string; disabled?: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckSummary | null>(null);
  const busy = running || refreshing;

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/check`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(friendly(res.status, body?.error));
      setResult(body as CheckSummary);
      startRefresh(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <button type="button" className={buttonPrimary} disabled={disabled || busy} onClick={run} aria-busy={busy}>
        {busy && <Spinner />}
        {running ? "Checking…" : refreshing ? "Updating…" : "Check now"}
      </button>
      {busy && (
        <p role="status" className="basis-full font-mono text-xs text-muted">
          {running ? "Searching, scoring and deciding. This can take up to a minute." : "Loading the new decision…"}
        </p>
      )}
      {error && (
        <div className="basis-full">
          <Notice tone="red">{error}</Notice>
        </div>
      )}
      {result && !busy && (
        <div className="basis-full">
          <Notice>
            <strong className="capitalize">{result.action.replace("_", " ")}.</strong> {result.reasoning}
            {result.error && <span className="mt-1 block text-refuse">{result.error}</span>}
          </Notice>
        </div>
      )}
    </>
  );
}
