// The persisted watch loop against fakes: fixture Channel3 and models, the recording PayPal fake, in-memory
// execute persistence, and a fake database that answers the loop's queries. These check the wiring and
// behaviour (what is written, when, for which orders), not the SQL text, which needs a real Postgres.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_SALE_ORDER, FILL_ORDER, FIXTURE_NOW, type FixtureOrder } from "@/fixtures/demo";
import {
  fixtureChannel3,
  fixtureScoreModel,
  recordingNotifier,
  recordingPayPal,
  rulesDecideModel,
} from "@/fixtures/fakes";
import type { DueOrder } from "@/lib/orders";
import { claimDueOrders } from "@/lib/orders";
import type { Queryable } from "@/lib/price-history";
import { HOLD_RECHECK_MINUTES } from "@/workflows/standing-order/config";
import { KILL_SWITCH_REASONING } from "@/workflows/standing-order/steps/guardrails";
import { runOrderCycle, tickOnce, type RunOrderDeps } from "@/workflows/standing-order/run-order";
import type {
  ApprovalRow,
  DecisionRow,
  ExecutePersistence,
  FillRow,
} from "@/workflows/standing-order/steps/execute";

const h = vi.hoisted(() => ({
  queries: [] as { sql: string; params: unknown[] }[],
  approvalStatus: "cancelled",
  captures: 0,
}));

// For the approvals route test only.
vi.mock("@/lib/db", () => ({
  getPool: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      h.queries.push({ sql, params });
      if (/FROM approvals WHERE token/.test(sql)) {
        return {
          rows: [
            { id: "appr-1", decision_id: "dec-1", paypal_order_id: "PP-1", expires_at: new Date(Date.now() + 3_600_000), resolution: null },
          ],
        };
      }
      if (/SELECT o\.status FROM decisions/.test(sql)) return { rows: [{ status: h.approvalStatus }] };
      return { rows: [], rowCount: 1 };
    },
  }),
}));
vi.mock("@/lib/paypal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/paypal")>()),
  captureOrder: async () => {
    h.captures++;
    return { status: "captured", capture_id: "CAP-1" };
  },
}));

// ---- fakes ----

interface OrderRowState extends DueOrder {
  next_check_at: string | null;
  last_checked_at: string | null;
  created_at: string;
}
interface PricePointRow {
  product_id: string;
  price_cents: number;
  observed_at: string;
}

function memoryPersistence() {
  const decisions = new Map<string, DecisionRow>();
  const fills = new Map<string, FillRow>();
  const approvals = new Map<string, ApprovalRow>();
  const persistence: ExecutePersistence = {
    async recordDecision(row) {
      const prior = decisions.get(row.id);
      decisions.set(row.id, prior ? { ...prior, explanation: row.explanation ?? prior.explanation } : row);
    },
    async insertPendingFill({ decisionId, merchant, amountCents }) {
      const existing = fills.get(decisionId);
      if (existing) return { inserted: false, fill: existing };
      const fill: FillRow = { decisionId, paypalOrderId: null, captureId: null, merchant, amountCents, status: "pending", error: null };
      fills.set(decisionId, fill);
      return { inserted: true, fill };
    },
    async updateFill(decisionId, patch) {
      const fill = fills.get(decisionId)!;
      fills.set(decisionId, {
        ...fill,
        paypalOrderId: patch.paypalOrderId ?? fill.paypalOrderId,
        captureId: patch.captureId ?? fill.captureId,
        status: patch.status ?? fill.status,
        error: patch.error ?? null,
      });
    },
    async insertApproval({ decisionId, token, paypalOrderId, expiresAt }) {
      approvals.set(decisionId, { token, paypalOrderId, expiresAt });
    },
    async findApproval(decisionId) {
      return approvals.get(decisionId) ?? null;
    },
  };
  return { persistence, decisions, fills, approvals };
}

function fakeDb(mem: ReturnType<typeof memoryPersistence>) {
  const state = {
    orders: [] as OrderRowState[],
    prices: [] as PricePointRow[],
    candidates: [] as unknown[][],
    killSwitch: false,
    calls: [] as { sql: string; params: unknown[] }[],
  };
  const db: Queryable = {
    async query<R>(sql: string, params: unknown[] = []) {
      state.calls.push({ sql, params });
      const rows = (r: unknown[]) => ({ rows: r as R[], rowCount: r.length });

      if (/WITH due AS/.test(sql)) {
        const [statuses, now, limit, leaseUntil] = params as [string[], string, number, string];
        const due = state.orders
          .filter((o) => statuses.includes(o.status) && (o.next_check_at === null || o.next_check_at <= now))
          .sort((a, b) => (a.next_check_at ?? a.created_at).localeCompare(b.next_check_at ?? b.created_at))
          .slice(0, limit);
        for (const o of due) o.next_check_at = leaseUntil;
        return rows(
          due.map((o) => ({
            id: o.id,
            user_id: o.user_id,
            spec: o.spec,
            max_price_cents: o.max_price_cents,
            per_order_cap_cents: o.per_order_cap_cents,
            monthly_cap_cents: o.monthly_cap_cents,
            merchant_allowlist: o.merchant_allowlist,
            status: o.status,
          })),
        );
      }
      if (/UPDATE standing_orders SET last_checked_at/.test(sql)) {
        const [id, checked, next] = params as [string, string, string | null];
        const o = state.orders.find((x) => x.id === id)!;
        o.last_checked_at = checked;
        o.next_check_at = next;
        return rows([]);
      }
      if (/UPDATE standing_orders SET status = 'filled'/.test(sql)) {
        state.orders.find((x) => x.id === params[0])!.status = "filled";
        return rows([]);
      }
      if (/FROM approvals a JOIN decisions d/.test(sql)) {
        const open = [...mem.approvals.values()].filter((a) => a.expiresAt > (params[1] as string));
        return rows(open.length ? [{ "?column?": 1 }] : []);
      }
      if (/INSERT INTO price_points/.test(sql)) {
        const [ids, prices, now] = params as [string[], number[], string];
        let inserted = 0;
        ids.forEach((id, i) => {
          const recent = state.prices.some(
            (p) => p.product_id === id && p.price_cents === prices[i] && Date.parse(p.observed_at) > Date.parse(now) - 3_600_000,
          );
          if (!recent) {
            state.prices.push({ product_id: id, price_cents: prices[i], observed_at: now });
            inserted++;
          }
        });
        return { rows: [] as R[], rowCount: inserted };
      }
      if (/FROM price_points/.test(sql)) {
        const [productId, before] = params as [string, string | null];
        return rows(
          state.prices
            .filter((p) => p.product_id === productId && (before === null || p.observed_at < before))
            .sort((a, b) => a.observed_at.localeCompare(b.observed_at))
            .map((p) => ({ price_cents: p.price_cents, observed_at: new Date(p.observed_at) })),
        );
      }
      if (/INSERT INTO candidates/.test(sql)) {
        state.candidates.push(params);
        return rows([]);
      }
      if (/SELECT kill_switch/.test(sql)) return rows([{ kill_switch: state.killSwitch }]);
      if (/COALESCE\(SUM/.test(sql)) return rows([{ cents: "0" }]);
      throw new Error(`fake db: unexpected SQL: ${sql.slice(0, 80)}`);
    },
  };
  return { db, state };
}

const iso = (offsetMs = 0) => new Date(Date.parse(FIXTURE_NOW) + offsetMs).toISOString();
const MIN = 60_000;

function dueOrder(fixture: FixtureOrder, over: Partial<OrderRowState> = {}): OrderRowState {
  return {
    id: fixture.id,
    user_id: "user-1",
    spec: fixture.spec,
    max_price_cents: fixture.policy.maxPriceCents,
    per_order_cap_cents: fixture.policy.perOrderCapCents,
    monthly_cap_cents: fixture.policy.monthlyCapCents,
    merchant_allowlist: fixture.policy.merchantAllowlist,
    status: "active",
    next_check_at: null,
    last_checked_at: null,
    created_at: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

function seedHistory(state: ReturnType<typeof fakeDb>["state"], fixture: FixtureOrder) {
  for (const [productId, points] of Object.entries(fixture.priceHistory(FIXTURE_NOW))) {
    for (const p of points) {
      state.prices.push({ product_id: productId, price_cents: p.priceCents, observed_at: p.observedAt });
    }
  }
}

function setup(fixture: FixtureOrder, over: Partial<RunOrderDeps> = {}) {
  const mem = memoryPersistence();
  const { db, state } = fakeDb(mem);
  const paypal = recordingPayPal();
  const notifier = recordingNotifier();
  let n = 0;
  const deps: RunOrderDeps = {
    db,
    channel3: fixtureChannel3(fixture.products),
    scoreModel: fixtureScoreModel(fixture.scores),
    decideModel: rulesDecideModel,
    paypal,
    notify: notifier,
    now: () => new Date(FIXTURE_NOW),
    persistence: mem.persistence,
    newId: () => `decision-${++n}`,
    newApprovalToken: () => `token-${n}`,
    appBaseUrl: "http://localhost:3000",
    ...over,
  };
  return { deps, mem, db, state, paypal, notifier };
}

beforeEach(() => {
  h.queries.length = 0;
  h.captures = 0;
});

// ---- tests ----

describe("runOrderCycle", () => {
  it("hold: schedules the next check HOLD_RECHECK_MINUTES out and leaves the order active", async () => {
    const { deps, state, paypal, mem } = setup(FILL_ORDER);
    const order = dueOrder(FILL_ORDER);
    state.orders.push(order);

    const summary = await runOrderCycle(order, deps);

    expect(summary).toMatchObject({ action: "hold", execution: "none", candidate: { productId: "sbx-mon-lumen27q" } });
    expect(summary.nextCheckAt).toBe(iso(HOLD_RECHECK_MINUTES * MIN));
    expect(state.orders[0]).toMatchObject({ status: "active", last_checked_at: FIXTURE_NOW, next_check_at: iso(HOLD_RECHECK_MINUTES * MIN) });
    expect(paypal.calls).toEqual([]);
    expect(mem.decisions.get("decision-1")).toMatchObject({ action: "hold" });
    expect(state.candidates).toHaveLength(1);
  });

  it("records every product Channel3 returned, and reads history without the observation just recorded", async () => {
    const { deps, state } = setup(FILL_ORDER);
    const order = dueOrder(FILL_ORDER);
    state.orders.push(order);

    await runOrderCycle(order, deps);

    const recorded = state.prices.filter((p) => p.observed_at === FIXTURE_NOW);
    expect(recorded.map((p) => [p.product_id, p.price_cents]).sort()).toEqual(
      FILL_ORDER.products.map((p) => [p.productId, p.priceCents]).sort(),
    );
    const historyRead = state.calls.find((c) => /SELECT price_cents, observed_at/.test(c.sql))!;
    expect(historyRead.params).toEqual(["sbx-mon-lumen27q", FIXTURE_NOW]);
  });

  it("builds history across ticks: a later run adds new rows, a repeat within the hour does not", async () => {
    const { deps, state } = setup(FILL_ORDER);
    const order = dueOrder(FILL_ORDER);
    state.orders.push(order);
    let t = Date.parse(FIXTURE_NOW);
    deps.now = () => new Date(t);

    await runOrderCycle(order, deps);
    expect(state.prices).toHaveLength(3);
    t += 2 * 60 * MIN;
    await runOrderCycle(order, deps);
    expect(state.prices).toHaveLength(6);
    t += 20 * MIN;
    await runOrderCycle(order, deps);
    expect(state.prices).toHaveLength(6); // same prices within the hour are not re-recorded
  });

  it("a fake sale in the loaded history drives skip, with no PayPal call and no approval", async () => {
    const { deps, state, paypal, mem } = setup(FAKE_SALE_ORDER);
    seedHistory(state, FAKE_SALE_ORDER);
    const order = dueOrder(FAKE_SALE_ORDER);
    state.orders.push(order);

    const summary = await runOrderCycle(order, deps);

    expect(summary).toMatchObject({ action: "skip", execution: "none", candidate: { productId: "ch3-hp-quietwave9" } });
    expect(summary.reasoning).toMatch(/fake sale/i);
    expect(summary.nextCheckAt).toBe(iso(HOLD_RECHECK_MINUTES * MIN)); // skip keeps watching
    expect(paypal.calls).toEqual([]);
    expect(mem.approvals.size).toBe(0);
    expect(mem.fills.size).toBe(0);
  });

  it("a null spec returns needs_review without calling a model or touching the database", async () => {
    const boom = { name: "boom", call: async () => { throw new Error("model must not be called"); } };
    const { deps, state } = setup(FILL_ORDER, {
      scoreModel: boom,
      decideModel: boom,
      channel3: { search: async () => { throw new Error("channel3 must not be called"); } },
    });
    const order = dueOrder(FILL_ORDER, { spec: null });
    state.orders.push(order);

    const summary = await runOrderCycle(order, deps);

    expect(summary).toMatchObject({ action: "needs_review", candidate: null, execution: null });
    expect(state.calls).toEqual([]);
  });

  it("tier 1: a captured vaulted fill marks the order filled and stops scheduling", async () => {
    const { deps, state, paypal } = setup(FILL_ORDER);
    seedHistory(state, FILL_ORDER);
    const order = dueOrder(FILL_ORDER);
    state.orders.push(order);

    const summary = await runOrderCycle(order, deps); // tests/setup.ts makes the sandbox store agent-ready

    expect(summary).toMatchObject({ action: "fill", execution: "filled", nextCheckAt: null });
    expect(paypal.calls.map((c) => c.method)).toEqual(["createAndCaptureWithVault"]);
    expect(state.orders[0]).toMatchObject({ status: "filled", next_check_at: null });
  });

  it("tier 2: leaves the approval pending until it expires, and does not open a second one meanwhile", async () => {
    vi.stubEnv("AGENT_READY_MERCHANTS", "");
    try {
      const { deps, state, paypal, mem } = setup(FILL_ORDER);
      seedHistory(state, FILL_ORDER);
      const order = dueOrder(FILL_ORDER);
      state.orders.push(order);

      const first = await runOrderCycle(order, deps);
      expect(first).toMatchObject({ action: "fill", execution: "approval_requested" });
      expect(first.nextCheckAt).toBe(iso(48 * 60 * MIN));
      expect(state.orders[0].status).toBe("active");
      expect(mem.approvals.size).toBe(1);

      const second = await runOrderCycle(order, deps);
      expect(second.action).toBe("awaiting_approval");
      expect(paypal.calls.map((c) => c.method)).toEqual(["createOrder"]);
      expect(mem.approvals.size).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("on failure it still pushes the order out, then rethrows", async () => {
    const { deps, state } = setup(FILL_ORDER, {
      channel3: { search: async () => { throw new Error("channel3 down"); } },
    });
    const order = dueOrder(FILL_ORDER);
    state.orders.push(order);

    await expect(runOrderCycle(order, deps)).rejects.toThrow("channel3 down");
    expect(state.orders[0].next_check_at).toBe(iso(HOLD_RECHECK_MINUTES * MIN));
  });
});

describe("kill switch", () => {
  it("blocks a proposed purchase: a skip decision with the kill_switch reason, and no fill, approval or PayPal call", async () => {
    const { deps, state, paypal, mem } = setup(FILL_ORDER);
    seedHistory(state, FILL_ORDER); // a genuine drop: the model would say fill (tier 1 here)
    state.killSwitch = true;
    const order = dueOrder(FILL_ORDER);
    state.orders.push(order);

    const summary = await runOrderCycle(order, deps);

    expect(summary).toMatchObject({ action: "skip", execution: "none", reasoning: KILL_SWITCH_REASONING });
    expect(mem.decisions.get("decision-1")).toMatchObject({
      modelAction: "fill",
      action: "skip",
      guardrailReasons: ["kill_switch"],
      reasoning: KILL_SWITCH_REASONING,
    });
    expect(mem.decisions.get("decision-1")?.explanation).toMatch(/kill switch is on/i);
    expect(paypal.calls).toEqual([]);
    expect(mem.fills.size).toBe(0);
    expect(mem.approvals.size).toBe(0);
    // The order keeps being watched.
    expect(state.orders[0]).toMatchObject({ status: "active", next_check_at: iso(HOLD_RECHECK_MINUTES * MIN) });
  });

  it("blocks the tier-2 path too (no PayPal order is created for approval)", async () => {
    vi.stubEnv("AGENT_READY_MERCHANTS", "");
    try {
      const { deps, state, paypal, mem } = setup(FILL_ORDER);
      seedHistory(state, FILL_ORDER);
      state.killSwitch = true;
      const order = dueOrder(FILL_ORDER);
      state.orders.push(order);

      const summary = await runOrderCycle(order, deps);

      expect(summary.action).toBe("skip");
      expect(paypal.calls).toEqual([]);
      expect(mem.approvals.size).toBe(0);
      expect(mem.fills.size).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("is enforced through the tick as well", async () => {
    const { deps, state, paypal, mem } = setup(FILL_ORDER);
    seedHistory(state, FILL_ORDER);
    state.killSwitch = true;
    state.orders.push(dueOrder(FILL_ORDER));

    const result = await tickOnce(deps);

    expect(result.results[0]).toMatchObject({ action: "skip", reasoning: KILL_SWITCH_REASONING });
    expect(paypal.calls).toEqual([]);
    expect(mem.fills.size).toBe(0);
  });

  it("does not touch a decision that was not a purchase: a hold stays a normal hold", async () => {
    const { deps, state, mem } = setup(FILL_ORDER); // no history: the model holds for Black Friday
    state.killSwitch = true;
    const order = dueOrder(FILL_ORDER);
    state.orders.push(order);

    const summary = await runOrderCycle(order, deps);

    expect(summary.action).toBe("hold");
    expect(mem.decisions.get("decision-1")).toMatchObject({ action: "hold", guardrailReasons: [] });
  });

  it("with it off, the same cycle buys", async () => {
    const { deps, state, paypal } = setup(FILL_ORDER);
    seedHistory(state, FILL_ORDER);
    state.orders.push(dueOrder(FILL_ORDER));

    const result = await tickOnce(deps);

    expect(result.results[0]).toMatchObject({ action: "fill", execution: "filled" });
    expect(paypal.calls.map((c) => c.method)).toEqual(["createAndCaptureWithVault"]);
  });
});

describe("considered set", () => {
  // Rows are written as one multi-row INSERT, 11 values per row.
  const rows = (params: unknown[]) =>
    Array.from({ length: params.length / 11 }, (_, i) => {
      const r = params.slice(i * 11, i * 11 + 11);
      return { orderId: r[0], productId: r[1], fit: r[6], seenAt: r[9], chosen: r[10] };
    });

  it("stores every scored product of a small check, marking only the pick as chosen", async () => {
    const { deps, state } = setup(FILL_ORDER);
    const order = dueOrder(FILL_ORDER);
    state.orders.push(order);

    await runOrderCycle(order, deps);

    expect(state.candidates).toHaveLength(1);
    const stored = rows(state.candidates[0]);
    expect(stored).toHaveLength(3);
    expect(stored.filter((r) => r.chosen).map((r) => r.productId)).toEqual(["sbx-mon-lumen27q"]);
    expect(new Set(stored.map((r) => r.seenAt))).toEqual(new Set([FIXTURE_NOW]));
    expect(stored.every((r) => r.orderId === FILL_ORDER.id)).toBe(true);
  });

  it("keeps only the top 5 by fit, but always keeps the pick even if it ranks lower", async () => {
    const products = Array.from({ length: 7 }, (_, i) => ({
      productId: `p${i + 1}`,
      title: `Monitor ${i + 1}`,
      merchant: "shop.example",
      priceCents: 20000 + i,
      url: null,
    }));
    // p1..p6 score 99..94 but p1..p6 each fail a must-have; only p7 (fit 72) passes, so p7 is the pick.
    const scores = products.map((p, i) => ({
      productId: p.productId,
      fitScore: i === 6 ? 72 : 99 - i,
      mustHaves: [{ requirement: "27-inch", pass: i === 6 }],
      reasoning: "x",
    }));
    const { deps, state } = setup(FILL_ORDER, {
      channel3: fixtureChannel3(products),
      scoreModel: fixtureScoreModel(scores),
    });
    const order = dueOrder(FILL_ORDER);
    state.orders.push(order);

    const summary = await runOrderCycle(order, deps);

    const stored = rows(state.candidates[0]);
    expect(stored).toHaveLength(5);
    expect(stored.map((r) => r.productId)).toEqual(["p1", "p2", "p3", "p4", "p7"]);
    expect(stored.filter((r) => r.chosen).map((r) => r.productId)).toEqual(["p7"]);
    expect(summary.candidate?.productId).toBe("p7");
  });

  it("stores what was considered even when nothing qualified (no pick)", async () => {
    const products = [{ productId: "q1", title: "Q1", merchant: "shop.example", priceCents: 20000, url: null }];
    const scores = [{ productId: "q1", fitScore: 40, mustHaves: [{ requirement: "27-inch", pass: false }], reasoning: "x" }];
    const { deps, state } = setup(FILL_ORDER, { channel3: fixtureChannel3(products), scoreModel: fixtureScoreModel(scores) });
    const order = dueOrder(FILL_ORDER);
    state.orders.push(order);

    const summary = await runOrderCycle(order, deps);

    const stored = rows(state.candidates[0]);
    expect(stored).toHaveLength(1);
    expect(stored[0].chosen).toBe(false);
    expect(summary.candidate).toBeNull();
  });
});

describe("tick selection", () => {
  const statuses = ["paused", "cancelled", "filled", "needs_review"] as const;

  it("claims only due active orders: never paused, cancelled, filled or needs_review, nor future-dated ones", async () => {
    const { db, state } = setup(FILL_ORDER);
    state.orders.push(
      dueOrder(FILL_ORDER, { id: "due-null" }),
      dueOrder(FILL_ORDER, { id: "due-past", next_check_at: iso(-60 * MIN) }),
      dueOrder(FILL_ORDER, { id: "future", next_check_at: iso(60 * MIN) }),
      ...statuses.map((status) => dueOrder(FILL_ORDER, { id: status, status })),
    );

    const claimed = await claimDueOrders(db, new Date(FIXTURE_NOW), 10, 15);

    expect(claimed.map((o) => o.id).sort()).toEqual(["due-null", "due-past"]);
    const query = state.calls.find((c) => /WITH due AS/.test(c.sql))!;
    expect(query.params[0]).toEqual(["active"]);
    // Claimed orders are leased so an overlapping tick skips them.
    expect(state.orders.find((o) => o.id === "due-null")!.next_check_at).toBe(iso(15 * MIN));
  });

  it("one failing order does not abort the batch; the response carries its error", async () => {
    let calls = 0;
    const { deps, state } = setup(FILL_ORDER, {
      channel3: {
        search: async (p) => {
          if (++calls === 1) throw new Error("channel3 down");
          return fixtureChannel3(FILL_ORDER.products).search(p);
        },
      },
    });
    state.orders.push(dueOrder(FILL_ORDER, { id: "a" }), dueOrder(FILL_ORDER, { id: "b", created_at: "2026-11-02T00:00:00.000Z" }));

    const result = await tickOnce(deps);

    expect(result.checked).toBe(2);
    expect(result.results[0]).toEqual({ orderId: "a", error: "channel3 down" });
    expect(result.results[1]).toMatchObject({ orderId: "b", action: "hold" });
  });
});

describe("POST /api/approvals/[token] on a cancelled order", () => {
  it("does not capture: 409, the approval is rejected, the pending fill fails", async () => {
    h.approvalStatus = "cancelled";
    const { POST } = await import("@/app/api/approvals/[token]/route");
    const res = await POST(new Request("http://x/api/approvals/tok", { method: "POST" }), {
      params: Promise.resolve({ token: "tok" }),
    } as never);

    expect(res.status).toBe(409);
    expect(h.captures).toBe(0);
    expect(h.queries.some((q) => /UPDATE approvals SET resolution = 'rejected'/.test(q.sql))).toBe(true);
    expect(h.queries.some((q) => /UPDATE fills SET status = 'failed'/.test(q.sql))).toBe(true);
  });

  it("still captures when the order is active", async () => {
    h.approvalStatus = "active";
    const { POST } = await import("@/app/api/approvals/[token]/route");
    const res = await POST(new Request("http://x/api/approvals/tok", { method: "POST" }), {
      params: Promise.resolve({ token: "tok" }),
    } as never);

    expect(res.status).toBe(200);
    expect(h.captures).toBe(1);
  });
});
