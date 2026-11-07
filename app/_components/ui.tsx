// Small shared pieces for the Standing Orders UI. Plain React + Tailwind; no component library.
// Palette: warm near-white page, ink text, hairline rules, and one accent (cobalt) for links and focus.
// Status colours (green / red / amber / blue / gray) are the only other colours and always carry a text label.
import Link from "next/link";
import type { ReactNode } from "react";

export const ACCENT = "text-[#2748d4]";

export function Shell({ children, width = "max-w-3xl" }: { children: ReactNode; width?: string }) {
  return (
    <div className="min-h-screen bg-[#fbfaf7] font-sans text-[#1c1b19] antialiased">
      <header className="border-b border-[#e7e5df]">
        <div className={`mx-auto flex w-full items-baseline justify-between gap-4 px-5 py-4 ${width}`}>
          <Link href="/" className="font-serif text-lg tracking-tight">
            Standing Orders
          </Link>
          <nav className="flex gap-5 text-sm text-[#6b6a64]">
            <Link href="/orders" className="hover:text-[#1c1b19]">
              Orders
            </Link>
            <Link href="/store" className="hover:text-[#1c1b19]">
              Sandbox store
            </Link>
          </nav>
        </div>
      </header>
      <main className={`mx-auto w-full px-5 py-10 sm:py-14 ${width}`}>{children}</main>
    </div>
  );
}

type Tone = "green" | "red" | "amber" | "blue" | "gray";

const TONES: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-[#eef1fd] text-[#2748d4] ring-[#c9d2f6]",
  gray: "bg-[#f1f0ec] text-[#5c5b55] ring-[#e0ded7]",
};

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

const ORDER_STATUS: Record<string, { tone: Tone; label: string }> = {
  active: { tone: "blue", label: "Watching" },
  needs_review: { tone: "gray", label: "Needs review" },
  paused: { tone: "amber", label: "Paused" },
  filled: { tone: "green", label: "Filled" },
  cancelled: { tone: "gray", label: "Cancelled" },
};

export function OrderStatusPill({ status }: { status: string }) {
  const s = ORDER_STATUS[status] ?? { tone: "gray" as const, label: status };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

const ACTIONS: Record<string, { tone: Tone; label: string }> = {
  fill: { tone: "green", label: "Fill" },
  skip: { tone: "red", label: "Skip" },
  hold: { tone: "amber", label: "Hold" },
  ask: { tone: "blue", label: "Ask" },
  needs_review: { tone: "gray", label: "Needs review" },
};

export function ActionPill({ action }: { action: string | null }) {
  if (!action) return <span className="text-sm text-[#a3a199]">No checks yet</span>;
  const a = ACTIONS[action] ?? { tone: "gray" as const, label: action };
  return <Pill tone={a.tone}>{a.label}</Pill>;
}

/** Ids, prices and scores are set in the mono face. */
export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[0.92em] tabular-nums ${className}`}>{children}</span>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-4 text-xs font-medium uppercase tracking-[0.14em] text-[#6b6a64]">{children}</h2>;
}

const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2748d4] disabled:cursor-not-allowed disabled:opacity-45";

export const buttonPrimary = `${BUTTON_BASE} bg-[#1c1b19] text-[#fbfaf7] hover:bg-[#3a3935]`;
export const buttonQuiet = `${BUTTON_BASE} border border-[#d6d4cc] text-[#1c1b19] hover:bg-[#f1f0ec]`;
export const fieldClass =
  "w-full rounded-lg border border-[#d6d4cc] bg-white px-3.5 py-2.5 text-base text-[#1c1b19] placeholder:text-[#a3a199] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#2748d4]";

export function Notice({ tone = "gray", children }: { tone?: "gray" | "red" | "amber"; children: ReactNode }) {
  const styles = {
    gray: "border-[#e0ded7] bg-[#f4f3ef] text-[#3a3935]",
    red: "border-red-200 bg-red-50 text-red-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
  };
  return (
    <p role={tone === "red" ? "alert" : undefined} className={`rounded-lg border px-4 py-3 text-sm ${styles[tone]}`}>
      {children}
    </p>
  );
}
