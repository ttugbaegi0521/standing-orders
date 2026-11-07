// Tier 2: the user approved the PayPal order; capture it and record the outcome.
// Safe to POST twice: the capture reuses PayPal-Request-Id, and the approval resolves only once.
import { getPool } from "@/lib/db";
import { captureOrder } from "@/lib/paypal";

interface ApprovalRow {
  id: string;
  decision_id: string;
  paypal_order_id: string | null;
  expires_at: Date;
  resolution: string | null;
}

export async function POST(_req: Request, ctx: RouteContext<"/api/approvals/[token]">) {
  const { token } = await ctx.params;
  const db = getPool();

  const { rows } = await db.query<ApprovalRow>(
    "SELECT id, decision_id, paypal_order_id, expires_at, resolution FROM approvals WHERE token = $1",
    [token],
  );
  const approval = rows[0];
  if (!approval) return Response.json({ error: "Unknown approval" }, { status: 404 });
  if (approval.resolution === "approved") return Response.json({ status: "already_approved" });
  if (approval.resolution) return Response.json({ error: `Approval is ${approval.resolution}` }, { status: 410 });
  if (approval.expires_at.getTime() < Date.now()) {
    await db.query(
      "UPDATE approvals SET resolution = 'expired', resolved_at = now() WHERE id = $1 AND resolved_at IS NULL",
      [approval.id],
    );
    return Response.json({ error: "Approval expired" }, { status: 410 });
  }
  if (!approval.paypal_order_id) return Response.json({ error: "Approval has no PayPal order" }, { status: 409 });

  try {
    const captured = await captureOrder(approval.paypal_order_id);
    const status =
      captured.status === "captured" ? "captured" : captured.status === "approved" ? "pending" : "failed";
    await db.query(
      `UPDATE fills SET status = $2, capture_id = COALESCE($3, capture_id), error = $4, updated_at = now()
       WHERE decision_id = $1`,
      [approval.decision_id, status, captured.capture_id, status === "failed" ? "PayPal did not capture the order" : null],
    );
    if (status === "failed") {
      return Response.json({ error: "PayPal did not capture the order" }, { status: 502 });
    }
    await db.query(
      "UPDATE approvals SET resolution = 'approved', resolved_at = now() WHERE id = $1 AND resolved_at IS NULL",
      [approval.id],
    );
    return Response.json({ status, capture_id: captured.capture_id });
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    console.error("[approvals]", message);
    // The approval stays unresolved so the user can retry.
    await db
      .query("UPDATE fills SET status = 'failed', error = $2, updated_at = now() WHERE decision_id = $1", [
        approval.decision_id,
        message,
      ])
      .catch(() => undefined);
    return Response.json({ error: "Capture failed" }, { status: 502 });
  }
}
