"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Notice, buttonPrimary } from "./ui";

/**
 * PayPal sends the buyer back to /approvals/<token> after they approve, and nothing else captures the payment,
 * so this posts the capture once on load, then refreshes the page to show the result. Retry posts it again
 * (safe: the capture is idempotent on PayPal's side).
 */
export function FinalizeApproval({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<"running" | "failed">("running");
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  const finalize = useCallback(async () => {
    setState("running");
    setMessage(null);
    try {
      const res = await fetch(`/api/approvals/${token}`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      setState("failed");
    }
  }, [token, router]);

  useEffect(() => {
    if (started.current) return; // React strict mode runs effects twice in development
    started.current = true;
    void finalize();
  }, [finalize]);

  if (state === "running") {
    return (
      <div role="status" className="flex items-center gap-3">
        <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#2748d4]" />
        <p className="font-serif text-xl">Finalizing…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Notice tone="amber">
        {message ?? "PayPal has not confirmed this purchase yet."} If you have not approved it on PayPal yet,
        go back to the order and use “Approve purchase”.
      </Notice>
      <button type="button" className={buttonPrimary} onClick={() => void finalize()}>
        Try again
      </button>
    </div>
  );
}
