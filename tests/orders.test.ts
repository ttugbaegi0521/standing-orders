// Order routes against an in-memory OrderStore (no database), plus the approvals route's status-on-fill
// against a recording fake pool. These verify the HTTP behaviour and the flow, not the SQL text.
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_SALE_ORDER, FILL_ORDER } from "@/fixtures/demo";
import type { OrderDetail, OrderStatus, OrderStore, OrderSummary } from "@/lib/orders";
import type { Spec } from "@/lib/schemas";

const h = vi.hoisted(() => ({
  store: null as unknown as OrderStore,
  queries: [] as { sql: string; params: unknown[] }[],
  captureResult: { status: "captured", capture_id: "CAP-1" } as { status: string; capture_id: string | null },
  liveModelsBuilt: 0,
}));

// Stand-in for real Claude: refuses to build without a key (like the real one) and answers with a fixed spec.
vi.mock("@/lib/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/model")>()),
  createClaudeModel: () => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
    h.liveModelsBuilt++;
    const spec = {
      category: "live-parsed gadget",
      mustHaves: ["works"],
      niceToHaves: [],
      maxPriceCents: 12345,
      constraints: [],
      restatement: "A gadget that works, under $123.45.",
    };
    return new MockLanguageModelV4({
      modelId: "mock-live-claude",
      doGenerate: async () => ({
        content: [{ type: "text" as const, text: JSON.stringify(spec) }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }),
    });
  },
}));

vi.mock("@/lib/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orders")>()),
  getOrderStore: () => h.store,
}));

vi.mock("@/lib/db", () => ({
  getPool: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      h.queries.push({ sql, params });
      if (/FROM approvals WHERE token/.test(sql)) {
        return {
          rows: [
            {
              id: "appr-1",
              decision_id: "dec-1",
              paypal_order_id: "PP-1",
              expires_at: new Date(Date.now() + 3_600_000),
              resolution: null,
            },
          ],
        };
      }
      return { rows: [], rowCount: 1 };
    },
  }),
}));

vi.mock("@/lib/paypal", () => ({
  captureOrder: async () => h.captureResult,
}));

const actual = await vi.importActual<typeof import("@/lib/orders")>("@/lib/orders");

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER_USER = "00000000-0000-4000-8000-000000000002";

interface Row {
  id: string;
  userId: string;
  rawIntent: string;
  spec: Spec | null;
  maxPriceCents: number | null;
  status: OrderStatus;
  createdAt: string;
  decisions: OrderDetail["decisions"];
}

function fakeStore() {
  const rows: Row[] = [];
  let n = 0;
  const store: OrderStore = {
    async insertOrder(r) {
      const id = `00000000-0000-4000-8000-${String(100 + ++n).padStart(12, "0")}`;
      rows.push({
        id,
        userId: r.userId,
        rawIntent: r.rawIntent,
        spec: null,
        maxPriceCents: null,
        status: "needs_review",
        createdAt: new Date(2026, 10, n).toISOString(),
        decisions: [],
      });
      return { id };
    },
    async setParsedSpec(id, spec) {
      const row = rows.find((r) => r.id === id)!;
      row.spec = spec;
      row.maxPriceCents = spec.maxPriceCents;
      row.status = "active";
    },
    async listOrders(userId) {
      return rows
        .filter((r) => r.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map<OrderSummary>((r) => ({
          id: r.id,
          raw_intent: r.rawIntent,
          max_price_cents: r.maxPriceCents,
          status: r.status,
          created_at: r.createdAt,
          latest_action: r.decisions[0]?.action ?? null,
        }));
    },
    async getOrderDetail(id, userId) {
      const r = rows.find((x) => x.id === id && x.userId === userId);
      if (!r) return null;
      return {
        order: {
          id: r.id,
          raw_intent: r.rawIntent,
          spec: r.spec,
          max_price_cents: r.maxPriceCents,
          per_order_cap_cents: 30000,
          monthly_cap_cents: 60000,
          merchant_allowlist: [],
          status: r.status,
          created_at: r.createdAt,
          updated_at: r.createdAt,
        },
        latest_candidate: null,
        considered: [],
        decisions: r.decisions,
        open_approvals: [],
        fills: [],
      };
    },
    async transition(id, userId, to) {
      const r = rows.find((x) => x.id === id && x.userId === userId);
      if (!r) return { kind: "not_found" };
      const verdict = actual.decideTransition(r.status, to);
      if (verdict === "conflict") return { kind: "conflict", status: r.status };
      r.status = to;
      return { kind: "ok", status: r.status };
    },
  };
  return { store, rows };
}

const body = (over: Record<string, unknown> = {}) => ({
  rawIntent: FILL_ORDER.rawIntent,
  perOrderCapCents: 30000,
  monthlyCapCents: 60000,
  merchantAllowlist: ["acme-electronics"],
  ...over,
});

const post = (url: string, json?: unknown) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json ?? {}) });

let db: ReturnType<typeof fakeStore>;

beforeEach(() => {
  db = fakeStore();
  h.store = db.store;
  h.queries.length = 0;
  h.captureResult = { status: "captured", capture_id: "CAP-1" };
  vi.stubEnv("DEMO_USER_ID", USER);
  vi.stubEnv("USE_LIVE_MODEL", "");
  vi.stubEnv("ANTHROPIC_API_KEY", ""); // the default tests run on the fixture parser, whatever the shell has set
  h.liveModelsBuilt = 0;
});

async function create(json: unknown) {
  const { POST } = await import("@/app/api/orders/route");
  return POST(post("http://x/api/orders", json));
}

describe("POST /api/orders", () => {
  it("inserts the order, parses the intent, stores spec and max price, returns 201 with the id", async () => {
    const res = await create(body());
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toMatchObject({ status: "active", spec: { category: "computer monitor" } });
    expect(json.warning).toBeUndefined();
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ id: json.id, userId: USER, status: "active", maxPriceCents: 30000 });
    expect(db.rows[0].spec?.restatement).toBeTruthy();
  });

  it("a failed parse still creates the order as needs_review, with a warning, and returns 201", async () => {
    const res = await create(body({ rawIntent: "something the fixture parser has never seen" }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.warning).toMatch(/not parsed/i);
    expect(json).toMatchObject({ status: "needs_review", spec: null });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ status: "needs_review", spec: null, maxPriceCents: null });
  });

  it("with USE_LIVE_MODEL=true and no API key, it is a warning, not a 500", async () => {
    vi.stubEnv("USE_LIVE_MODEL", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await create(body());
    expect(res.status).toBe(201);
    expect((await res.json()).warning).toMatch(/ANTHROPIC_API_KEY/);
    expect(db.rows[0].status).toBe("needs_review");
  });

  it("rejects an invalid body with 400 and inserts nothing", async () => {
    const res = await create({ rawIntent: "x" });
    expect(res.status).toBe(400);
    expect(db.rows).toHaveLength(0);
  });
});

describe("GET /api/orders", () => {
  it("lists the demo user's orders newest first, with the latest decision action", async () => {
    await create(body());
    await create(body({ rawIntent: FAKE_SALE_ORDER.rawIntent }));
    db.rows[0].decisions = [
      { id: "d1", action: "hold", model_action: "hold", guardrail_reasons: [], reasoning: "wait", explanation: null, created_at: "2026-11-02T00:00:00Z" },
    ];
    db.rows.push({ ...db.rows[0], id: "other", userId: OTHER_USER });

    const { GET } = await import("@/app/api/orders/route");
    const { orders } = await (await GET()).json();

    expect(orders.map((o: OrderSummary) => o.raw_intent)).toEqual([FAKE_SALE_ORDER.rawIntent, FILL_ORDER.rawIntent]);
    expect(orders[1]).toMatchObject({ latest_action: "hold", max_price_cents: 30000 });
    expect(orders[0].latest_action).toBeNull();
  });
});

describe("GET /api/orders/[id]", () => {
  const get = async (id: string) => {
    const { GET } = await import("@/app/api/orders/[id]/route");
    return GET(new Request(`http://x/api/orders/${id}`), { params: Promise.resolve({ id }) } as never);
  };

  it("returns the order with its spec and decisions newest-first", async () => {
    const { id } = await (await create(body())).json();
    db.rows[0].decisions = [
      { id: "d2", action: "ask", model_action: "fill", guardrail_reasons: ["not on allowlist"], reasoning: "newer", explanation: null, created_at: "2026-11-03T00:00:00Z" },
      { id: "d1", action: "hold", model_action: "hold", guardrail_reasons: [], reasoning: "older", explanation: null, created_at: "2026-11-02T00:00:00Z" },
    ];

    const res = await get(id);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.order.spec.category).toBe("computer monitor");
    expect(json.decisions.map((d: { id: string }) => d.id)).toEqual(["d2", "d1"]);
    expect(json.decisions[0]).toMatchObject({ action: "ask", model_action: "fill", guardrail_reasons: ["not on allowlist"] });
    expect(json).toHaveProperty("open_approvals");
    expect(json).toHaveProperty("fills");
  });

  it("404s for an unknown id, a malformed id, and another user's order", async () => {
    const { id } = await (await create(body())).json();
    db.rows[0].userId = OTHER_USER;
    expect((await get(id)).status).toBe(404);
    expect((await get("00000000-0000-4000-8000-0000000fffff")).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(404);
  });
});

describe("pause and cancel", () => {
  const act = async (kind: "pause" | "cancel", id: string) => {
    const mod =
      kind === "pause"
        ? await import("@/app/api/orders/[id]/pause/route")
        : await import("@/app/api/orders/[id]/cancel/route");
    return mod.POST(post(`http://x/api/orders/${id}/${kind}`), { params: Promise.resolve({ id }) } as never);
  };

  it("pause sets paused; cancel sets cancelled", async () => {
    const { id } = await (await create(body())).json();
    const paused = await act("pause", id);
    expect(await paused.json()).toEqual({ id, status: "paused" });
    expect(db.rows[0].status).toBe("paused");

    const cancelled = await act("cancel", id);
    expect(await cancelled.json()).toEqual({ id, status: "cancelled" });
    expect(db.rows[0].status).toBe("cancelled");
  });

  it("is idempotent, and refuses to pause a cancelled or filled order", async () => {
    const { id } = await (await create(body())).json();
    expect((await act("pause", id)).status).toBe(200);
    expect((await act("pause", id)).status).toBe(200);

    db.rows[0].status = "cancelled";
    expect((await act("pause", id)).status).toBe(409);
    db.rows[0].status = "filled";
    expect((await act("cancel", id)).status).toBe(409);
    expect(db.rows[0].status).toBe("filled");
  });

  it("404s when not found or not owned", async () => {
    const { id } = await (await create(body())).json();
    db.rows[0].userId = OTHER_USER;
    expect((await act("pause", id)).status).toBe(404);
    expect((await act("cancel", "nope")).status).toBe(404);
    expect(db.rows[0].status).toBe("active");
  });

  it("only active orders are runnable by a cycle", () => {
    const statuses: OrderStatus[] = ["active", "needs_review", "paused", "filled", "cancelled"];
    expect(statuses.filter((s) => actual.isRunnable(s))).toEqual(["active"]);
  });
});

describe("POST /api/approvals/[token]: status on fill", () => {
  const approve = async () => {
    const { POST } = await import("@/app/api/approvals/[token]/route");
    return POST(post("http://x/api/approvals/tok"), { params: Promise.resolve({ token: "tok" }) } as never);
  };
  const filledUpdates = () => h.queries.filter((q) => /UPDATE standing_orders SET status = 'filled'/.test(q.sql));

  it("marks the parent order filled after a successful capture, alongside the fills and approvals updates", async () => {
    const res = await approve();
    expect(res.status).toBe(200);
    expect(h.queries.some((q) => /UPDATE fills SET status/.test(q.sql))).toBe(true);
    expect(h.queries.some((q) => /UPDATE approvals SET resolution = 'approved'/.test(q.sql))).toBe(true);
    expect(filledUpdates()).toHaveLength(1);
    expect(filledUpdates()[0].params).toEqual(["dec-1"]);
  });

  it("does not mark it filled when the capture failed", async () => {
    h.captureResult = { status: "failed", capture_id: null };
    const res = await approve();
    expect(res.status).toBe(502);
    expect(filledUpdates()).toHaveLength(0);
  });
});

describe("live by default (POST /api/orders parse model)", () => {
  const unseen = () => body({ rawIntent: "a gadget the fixture parser has never heard of" });

  it("with an API key and no flag, parses with live Claude", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    const res = await create(unseen());
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(h.liveModelsBuilt).toBe(1);
    expect(json).toMatchObject({ status: "active", spec: { category: "live-parsed gadget" } });
    expect(db.rows[0]).toMatchObject({ status: "active", maxPriceCents: 12345 });
  });

  it("USE_LIVE_MODEL=false forces the fixture parser even with a key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("USE_LIVE_MODEL", "false");
    const json = await (await create(unseen())).json();

    expect(h.liveModelsBuilt).toBe(0);
    expect(json).toMatchObject({ status: "needs_review", spec: null });
  });

  it("without a key it falls back to the fixture parser", async () => {
    const json = await (await create(body())).json(); // a seeded intent
    expect(h.liveModelsBuilt).toBe(0);
    expect(json).toMatchObject({ status: "active", spec: { category: "computer monitor" } });
  });

  it("isLiveModelEnabled: key decides unless the flag says otherwise", async () => {
    const { isLiveModelEnabled } = await vi.importActual<typeof import("@/lib/model")>("@/lib/model");
    expect(isLiveModelEnabled({})).toBe(false);
    expect(isLiveModelEnabled({ ANTHROPIC_API_KEY: "k" })).toBe(true);
    expect(isLiveModelEnabled({ ANTHROPIC_API_KEY: "k", USE_LIVE_MODEL: "" })).toBe(true);
    expect(isLiveModelEnabled({ ANTHROPIC_API_KEY: "k", USE_LIVE_MODEL: "false" })).toBe(false);
    expect(isLiveModelEnabled({ ANTHROPIC_API_KEY: "k", USE_LIVE_MODEL: "FALSE " })).toBe(false);
    expect(isLiveModelEnabled({ USE_LIVE_MODEL: "true" })).toBe(true);
  });
});
