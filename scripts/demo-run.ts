// Produces both seeded demos by running the real thing, not by writing rows: one persisted cycle
// (workflows/standing-order/run-order.ts) per seeded order, over its seeded candidate and price history.
//
//   Headphones: the history is a fake sale, so the decide step refuses (skip). PayPal is stubbed to refuse,
//               so this order can never create or capture anything.
//   Monitor:    a genuine drop to the 30-day low, so the decide step accepts. Step 5 runs tier 2 (see below):
//               it writes a pending fill and an approval, and creates an un-captured PayPal sandbox order. You
//               finish the purchase in the browser: open the order, "Approve purchase", approve on PayPal, and
//               the return page captures it and the order flips to Filled.
//
// The decide step is live Claude when ANTHROPIC_API_KEY is set (USE_LIVE_MODEL=false forces the fixture model).
// Search and scoring use the fixtures, so Channel3 is never called. The monitor needs PayPal sandbox credentials.
// AGENT_READY_MERCHANTS is ignored here (cleared for this run): tier 1 needs a vaulted payment method, which
// the sandbox does not allow, so the monitor is always routed to tier 2 (approval link).
//
// Needs DATABASE_URL and DEMO_USER_ID, after `npm run db:migrate && npm run db:seed`.
// Usage: npm run demo-run
import { FAKE_SALE_ORDER, FILL_ORDER, type FixtureOrder } from "@/fixtures/demo";
import { fixtureChannel3, fixtureScoreModel, rulesDecideModel } from "@/fixtures/fakes";
import { getPool } from "@/lib/db";
import { getDecideModel, isLiveModelEnabled } from "@/lib/model";
import { consoleNotifier, type Notifier } from "@/lib/notify";
import { approveUrlFor, type DueOrder } from "@/lib/orders";
import { createPayPalClient, type PayPalClient } from "@/lib/paypal";
import { runOrderCycle, type CycleSummary, type DecideModel } from "@/workflows/standing-order/run-order";

const refuse = async (): Promise<never> => {
  throw new Error("demo-run never calls PayPal for this order");
};
const noPayPal: PayPalClient = { createAndCaptureWithVault: refuse, createOrder: refuse, captureOrder: refuse };

interface Result {
  label: string;
  ok: boolean;
  headline: string;
}

interface OpenApproval {
  token: string;
  paypal_order_id: string | null;
  expires_at: Date;
}

function show(title: string) {
  console.log(`\n=== ${title} ===`);
}

/** Looks up the seeded order and checks the seed data is all there; returns the order or throws. */
async function loadSeeded(fixture: FixtureOrder, userId: string): Promise<DueOrder> {
  const db = getPool();
  const { rows } = await db.query<DueOrder>(
    `SELECT id, user_id, spec, max_price_cents, per_order_cap_cents, monthly_cap_cents, merchant_allowlist, status
       FROM standing_orders WHERE id = $1 AND user_id = $2`,
    [fixture.id, userId],
  );
  const order = rows[0];
  if (!order) throw new Error("The seeded order is missing. Run: npm run db:migrate && npm run db:seed");
  if (order.status !== "active") throw new Error(`The order is ${order.status}. Run npm run db:seed to reset it.`);

  const productId = fixture.products[0].productId;
  const [candidate, history] = await Promise.all([
    db.query("SELECT 1 FROM candidates WHERE order_id = $1 AND channel3_product_id = $2", [order.id, productId]),
    db.query<{ n: string }>("SELECT count(*) AS n FROM price_points WHERE product_id = $1", [productId]),
  ]);
  const points = Number(history.rows[0]?.n ?? 0);
  if (candidate.rows.length === 0 || points < 3) {
    throw new Error(`The seed data is incomplete (${candidate.rows.length} candidate rows, ${points} price points). Run: npm run db:seed`);
  }
  console.log(`seeded price points: ${points}`);
  return order;
}

function printSummary(summary: CycleSummary) {
  console.log(`action:    ${summary.action}${summary.execution ? ` (execute: ${summary.execution})` : ""}`);
  console.log(`reasoning: ${summary.reasoning}`);
  if (summary.error) console.log(`error:     ${summary.error}`);
}

async function main() {
  const userId = process.env.DEMO_USER_ID;
  if (!userId) throw new Error("DEMO_USER_ID is not set");
  const db = getPool();
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";

  const live = isLiveModelEnabled();
  const decideModel: DecideModel = live ? getDecideModel() : rulesDecideModel;
  console.log(`decide model: ${live ? "live claude" : "fake"}`);

  if (process.env.AGENT_READY_MERCHANTS?.trim()) {
    console.log("note: AGENT_READY_MERCHANTS is set; ignoring it for this run (the monitor goes through tier 2).");
    process.env.AGENT_READY_MERCHANTS = "";
  }

  const results: Result[] = [];
  const attempt = async (label: string, run: () => Promise<Result>) => {
    try {
      results.push(await run());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(message);
      results.push({ label, ok: false, headline: message });
    }
  };

  // ---- Headphones: refusal ----
  await attempt("Headphones", async () => {
    show("Headphones: the agent refuses a fake sale");
    const order = await loadSeeded(FAKE_SALE_ORDER, userId);
    const summary = await runOrderCycle(order, {
      db,
      channel3: fixtureChannel3(FAKE_SALE_ORDER.products),
      scoreModel: fixtureScoreModel(FAKE_SALE_ORDER.scores),
      decideModel,
      paypal: noPayPal,
      notify: consoleNotifier,
      now: () => new Date(),
    });
    printSummary(summary);
    console.log(`open:      ${baseUrl}/orders/${order.id}`);
    const ok = summary.action === "skip";
    if (!ok) console.error("Expected a skip on the seeded fake sale. Nothing was bought (PayPal is stubbed out).");
    return { label: "Headphones", ok, headline: ok ? "skip (fake sale refused)" : `${summary.action}, expected skip` };
  });

  // ---- Monitor: accept, then approve in the browser ----
  await attempt("Monitor", async () => {
    show("Monitor: the agent accepts a genuine drop and asks you to approve");
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
      throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are needed to create the monitor's sandbox order.");
    }
    const order = await loadSeeded(FILL_ORDER, userId);

    let notifiedLink: string | undefined;
    const notifier: Notifier = {
      async send(n) {
        if (n.link) notifiedLink = n.link;
        await consoleNotifier.send(n);
      },
    };
    const summary = await runOrderCycle(order, {
      db,
      channel3: fixtureChannel3(FILL_ORDER.products),
      scoreModel: fixtureScoreModel(FILL_ORDER.scores),
      decideModel,
      paypal: createPayPalClient(),
      notify: notifier,
      now: () => new Date(),
    });
    printSummary(summary);

    const { rows } = await db.query<OpenApproval>(
      `SELECT a.token, a.paypal_order_id, a.expires_at
         FROM approvals a JOIN decisions d ON d.id = a.decision_id
        WHERE d.order_id = $1 AND a.resolved_at IS NULL AND a.expires_at > now()
        ORDER BY a.created_at DESC LIMIT 1`,
      [order.id],
    );
    const approval = rows[0];
    console.log(`open:      ${baseUrl}/orders/${order.id}`);

    if (!approval) {
      const hint =
        summary.execution === "error"
          ? "Step 5 reported an error (see above)."
          : summary.action === "hold"
            ? "The decide step chose to wait; try again, or use the fixture model (USE_LIVE_MODEL=false)."
            : summary.reasoning.includes("kill switch")
              ? "The kill switch is on; turn it off on /orders."
              : "No approval was created.";
      console.error(`Expected an open approval on the monitor order. ${hint}`);
      return { label: "Monitor", ok: false, headline: `${summary.action}, no open approval` };
    }

    const url = notifiedLink ?? approveUrlFor(approval.paypal_order_id);
    console.log(`approval:  open until ${approval.expires_at.toISOString()}`);
    console.log(`approve:   ${url}`);
    console.log("Finish in the browser: open the order, click Approve purchase, approve on PayPal as the sandbox");
    console.log("buyer; you land back on the confirmation page, which captures it and flips the order to Filled.");
    return { label: "Monitor", ok: true, headline: `${summary.action}; approval open` };
  });

  show("Summary");
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.label}: ${r.headline}`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
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
