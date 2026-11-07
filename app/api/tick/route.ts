// The watch loop's driver. Each call checks every due, active order once and schedules its next check.
// Call it on a schedule (Render cron job, `curl`, or `npm run tick`). It runs live: real Channel3, real Claude,
// real PayPal. It never falls back to fixtures; with a key missing it answers 503.
import { getPool } from "@/lib/db";
import { buildLiveDeps, missingLiveKeys, tickOnce } from "@/workflows/standing-order/run-order";

export async function POST(req: Request) {
  // If TICK_SECRET is set, only callers presenting it may spend API credits and create PayPal orders.
  const secret = process.env.TICK_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const missing = missingLiveKeys();
  if (missing.length > 0) {
    return Response.json(
      { error: `The watch loop runs live and needs ${missing.join(" and ")}. Nothing was checked.` },
      { status: 503 },
    );
  }

  return Response.json(await tickOnce(buildLiveDeps(getPool())));
}
