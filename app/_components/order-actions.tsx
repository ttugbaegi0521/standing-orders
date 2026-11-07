"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Notice, buttonPrimary, buttonQuiet } from "./ui";

interface CheckSummary {
  action: string;
  reasoning: string;
  execution: string | null;
  error?: string;
}

/** Check now / Pause / Cancel for one order. Every action refreshes the server-rendered page when it finishes. */
export function OrderActions({ orderId, status }: { orderId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"check" | "pause" | "cancel" | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckSummary | null>(null);

  const open = status === "active" || status === "needs_review";
  const cancellable = open || status === "paused";

  async function run(kind: "check" | "pause" | "cancel") {
    setBusy(kind);
    setError(null);
    if (kind === "check") setResult(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/${kind}`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`);
      if (kind === "check") setResult(body as CheckSummary);
      setConfirmCancel(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonPrimary} disabled={!open || busy !== null} onClick={() => run("check")}>
          {busy === "check" ? "Checking… this can take a minute" : "Check now"}
        </button>
        <button type="button" className={buttonQuiet} disabled={!open || busy !== null} onClick={() => run("pause")}>
          {busy === "pause" ? "Pausing…" : "Pause"}
        </button>
        {confirmCancel ? (
          <>
            <button type="button" className={buttonQuiet} disabled={busy !== null} onClick={() => run("cancel")}>
              {busy === "cancel" ? "Cancelling…" : "Yes, cancel this order"}
            </button>
            <button type="button" className="text-sm text-[#6b6a64]" onClick={() => setConfirmCancel(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            className={buttonQuiet}
            disabled={!cancellable || busy !== null}
            onClick={() => setConfirmCancel(true)}
          >
            Cancel order
          </button>
        )}
      </div>

      {error && <Notice tone="red">{error}</Notice>}
      {result && (
        <Notice>
          <strong className="capitalize">{result.action.replace("_", " ")}.</strong> {result.reasoning}
          {result.error && <span className="mt-1 block text-red-800">{result.error}</span>}
        </Notice>
      )}
    </div>
  );
}
