import { createHash } from "node:crypto";

/** JSON.stringify with object keys sorted recursively, so equal inputs hash equally. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export function hashInput(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}
