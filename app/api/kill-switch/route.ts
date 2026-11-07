// The owner's global kill switch (users.kill_switch). While it is on, the watch loop never buys: a proposed
// purchase is recorded as a blocked decision instead (see run-order.ts). "me" is DEMO_USER_ID until real auth exists.
import { getPool } from "@/lib/db";
import { demoUserId, getKillSwitch, setKillSwitch } from "@/lib/orders";

const noUser = () => Response.json({ error: "DEMO_USER_ID is not set" }, { status: 500 });
const unknownUser = () => Response.json({ error: "User not found" }, { status: 404 });

export async function GET() {
  const userId = demoUserId();
  if (!userId) return noUser();
  const on = await getKillSwitch(getPool(), userId);
  return on === null ? unknownUser() : Response.json({ kill_switch: on });
}

/** Body `{ "on": true | false }` sets it; no body (or no `on`) flips it. Returns the new state. */
export async function POST(req: Request) {
  const userId = demoUserId();
  if (!userId) return noUser();

  const body = (await req.json().catch(() => null)) as { on?: unknown } | null;
  if (body?.on !== undefined && typeof body.on !== "boolean") {
    return Response.json({ error: "`on` must be true or false" }, { status: 400 });
  }
  const on = await setKillSwitch(getPool(), userId, body?.on as boolean | undefined);
  return on === null ? unknownUser() : Response.json({ kill_switch: on });
}
