/** Timestamps are shown in UTC so server and client render the same text. */
export function formatWhen(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
}

export function dollars(cents: number | null | undefined): string {
  return typeof cents === "number" ? `$${(cents / 100).toFixed(2)}` : "—";
}
