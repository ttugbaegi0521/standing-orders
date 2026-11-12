"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Notice, buttonQuiet } from "./ui";

/**
 * Pause and Cancel for one order (Check now is CheckNowButton). Rendered as a fragment so it shares a row with
 * CheckNowButton; both refresh the server-rendered page when they finish.
 */
export function OrderActions({ orderId, status }: { orderId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"pause" | "cancel" | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = status === "active" || status === "needs_review";
  const cancellable = open || status === "paused";

  async function run(kind: "pause" | "cancel") {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/${kind}`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`);
      setConfirmCancel(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button type="button" className={buttonQuiet} disabled={!open || busy !== null} onClick={() => run("pause")}>
        {busy === "pause" ? "Pausing…" : "Pause"}
      </button>
      {confirmCancel ? (
        <>
          <button type="button" className={buttonQuiet} disabled={busy !== null} onClick={() => run("cancel")}>
            {busy === "cancel" ? "Cancelling…" : "Yes, cancel this order"}
          </button>
          <button
            type="button"
            className="font-mono text-xs uppercase tracking-[0.08em] text-muted hover:text-accent"
            onClick={() => setConfirmCancel(false)}
          >
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
      {error && (
        <div className="basis-full">
          <Notice tone="red">{error}</Notice>
        </div>
      )}
    </>
  );
}
