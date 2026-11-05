import type { z } from "zod";

/** Parses a JSON body with `schema`; returns a 400 Response on failure. */
export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  const json = await req.json().catch(() => undefined);
  const result = schema.safeParse(json);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, response: Response.json({ error: result.error.issues }, { status: 400 }) };
}

export function notImplemented(what: string): Response {
  return Response.json({ error: `${what} is not implemented yet` }, { status: 501 });
}
