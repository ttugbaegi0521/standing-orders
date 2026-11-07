// GET/POST /api/kill-switch against a fake pool holding one user row. Checks the HTTP behaviour and the flow,
// not the SQL text.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  users: new Map<string, boolean>(),
  queries: [] as { sql: string; params: unknown[] }[],
}));

vi.mock("@/lib/db", () => ({
  getPool: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      h.queries.push({ sql, params });
      const id = params[0] as string;
      if (!h.users.has(id)) return { rows: [] };
      if (/^SELECT kill_switch/.test(sql)) return { rows: [{ kill_switch: h.users.get(id) }] };
      if (/kill_switch = NOT kill_switch/.test(sql)) {
        h.users.set(id, !h.users.get(id));
        return { rows: [{ kill_switch: h.users.get(id) }] };
      }
      if (/SET kill_switch = \$2/.test(sql)) {
        h.users.set(id, params[1] as boolean);
        return { rows: [{ kill_switch: h.users.get(id) }] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  }),
}));

const USER = "00000000-0000-4000-8000-000000000001";

const post = (body?: unknown) =>
  new Request("http://x/api/kill-switch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  h.users.clear();
  h.users.set(USER, false);
  h.queries.length = 0;
  vi.stubEnv("DEMO_USER_ID", USER);
});

describe("/api/kill-switch", () => {
  it("GET returns the current state for DEMO_USER_ID", async () => {
    const { GET } = await import("@/app/api/kill-switch/route");
    expect(await (await GET()).json()).toEqual({ kill_switch: false });
    h.users.set(USER, true);
    expect(await (await GET()).json()).toEqual({ kill_switch: true });
  });

  it("POST with { on } sets it explicitly, and repeating is harmless", async () => {
    const { POST } = await import("@/app/api/kill-switch/route");
    expect(await (await POST(post({ on: true }))).json()).toEqual({ kill_switch: true });
    expect(await (await POST(post({ on: true }))).json()).toEqual({ kill_switch: true });
    expect(h.users.get(USER)).toBe(true);
    expect(await (await POST(post({ on: false }))).json()).toEqual({ kill_switch: false });
  });

  it("POST with no body toggles", async () => {
    const { POST } = await import("@/app/api/kill-switch/route");
    expect(await (await POST(post())).json()).toEqual({ kill_switch: true });
    expect(await (await POST(post({}))).json()).toEqual({ kill_switch: false });
  });

  it("rejects a non-boolean `on` with 400 and changes nothing", async () => {
    const { POST } = await import("@/app/api/kill-switch/route");
    const res = await POST(post({ on: "yes" }));
    expect(res.status).toBe(400);
    expect(h.users.get(USER)).toBe(false);
    expect(h.queries).toEqual([]);
  });

  it("404s for an unknown user and 500s without DEMO_USER_ID", async () => {
    const { GET, POST } = await import("@/app/api/kill-switch/route");
    h.users.clear();
    expect((await GET()).status).toBe(404);
    expect((await POST(post({ on: true }))).status).toBe(404);

    vi.stubEnv("DEMO_USER_ID", "");
    expect((await GET()).status).toBe(500);
    expect((await POST(post({ on: true }))).status).toBe(500);
  });
});
