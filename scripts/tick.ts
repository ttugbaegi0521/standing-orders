// Runs one tick of the watch loop directly (same code as POST /api/tick) and pretty-prints the results.
// Live: real Channel3, Claude and PayPal sandbox. Needs DATABASE_URL (migrated), ANTHROPIC_API_KEY,
// CHANNEL3_API_KEY and PayPal credentials.
// Usage: npm run tick
import { getPool } from "@/lib/db";
import { buildLiveDeps, missingLiveKeys, tickOnce } from "@/workflows/standing-order/run-order";

async function main() {
  const missing = missingLiveKeys();
  if (missing.length > 0) throw new Error(`The watch loop runs live and needs ${missing.join(" and ")}.`);

  const { checked, results } = await tickOnce(buildLiveDeps(getPool()));
  console.log(`Checked ${checked} order(s)`);
  let failed = 0;
  for (const r of results) {
    console.log(`\nOrder ${r.orderId}`);
    if (!("action" in r)) {
      failed++;
      console.log(`  ERROR: ${r.error}`);
      continue;
    }
    const s = r;
    console.log(`  action:     ${s.action}${s.execution ? ` (execute: ${s.execution})` : ""}`);
    console.log(
      s.candidate
        ? `  candidate:  ${s.candidate.title} — ${s.candidate.merchant} — $${(s.candidate.priceCents / 100).toFixed(2)}`
        : "  candidate:  none",
    );
    console.log(`  reasoning:  ${s.reasoning}`);
    console.log(`  next check: ${s.nextCheckAt ?? "none"}`);
    if (s.error) {
      failed++;
      console.log(`  ERROR:      ${s.error}`);
    }
  }
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await getPool().end();
    } catch {
      /* no pool to close */
    }
  });
