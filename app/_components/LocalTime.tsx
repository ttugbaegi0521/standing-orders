"use client";

import { useSyncExternalStore } from "react";
import { formatWhen } from "./format";

type Mode = "relative" | "absolute" | "both" | "date";

const subscribe = () => () => {};

function relative(d: Date): string {
  const seconds = Math.round((d.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return seconds > 0 ? "in a moment" : "just now";
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (abs >= size) return fmt.format(Math.round(seconds / size), unit);
  }
  return fmt.format(seconds, "second");
}

function render(iso: string, mode: Mode): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  if (mode === "relative") return relative(d);
  if (mode === "date") return d.toLocaleDateString(undefined, { dateStyle: "medium" });
  const absolute = d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return mode === "absolute" ? absolute : `${absolute} · ${relative(d)}`;
}

/**
 * A timestamp in the viewer's own timezone. The server cannot know it, so the server render and the first client
 * render both show the UTC text (useSyncExternalStore's server snapshot), and the browser swaps in the local
 * string right after hydration. No mismatch, no effect. The full local time is also the tooltip.
 */
export function LocalTime({ iso, mode = "both", className }: { iso: string | Date; mode?: Mode; className?: string }) {
  const value = typeof iso === "string" ? iso : iso.toISOString();
  const local = useSyncExternalStore(
    subscribe,
    () => render(value, mode),
    () => null,
  );
  const title =
    local === null || Number.isNaN(new Date(value).getTime())
      ? undefined
      : new Date(value).toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" });

  return (
    <time dateTime={value} title={title} className={className}>
      {local ?? (mode === "date" ? formatWhen(value).split(",").slice(0, 2).join(",") : formatWhen(value))}
    </time>
  );
}
