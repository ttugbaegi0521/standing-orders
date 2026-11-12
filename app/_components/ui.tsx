// Small shared pieces for the Standing Orders UI. Plain React + Tailwind; no component library.
// Colours and the type scale are tokens defined in app/globals.css: warm paper, ink text, hairline rules, and one
// accent (cobalt) for action and emphasis. Status colours (pos / warn / neg) always carry a text label.
import Link from "next/link";
import type { ReactNode } from "react";

export const ACCENT = "text-accent";

/** The mark: a price line dropping through a dashed limit, ending on the fill. */
function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden className="shrink-0">
      <line x1="1" x2="19" y1="10.5" y2="10.5" className="stroke-ink" strokeWidth="1.25" strokeDasharray="2 2.2" />
      <path d="M2 4.5 7.5 8 11 6 15 14" className="stroke-ink" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="15" cy="14" r="2.6" className="fill-accent" />
    </svg>
  );
}

export function Shell({ children, width = "max-w-3xl" }: { children: ReactNode; width?: string }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper font-sans text-ink antialiased">
      <header className="border-b border-rule">
        <div className={`mx-auto flex w-full items-center justify-between gap-4 px-5 py-4 sm:px-8 ${width}`}>
          <Link href="/" className="flex items-center gap-2.5 font-serif text-[1.1875rem] leading-none tracking-tight">
            <Mark />
            Standing Orders
          </Link>
          <nav className="flex gap-5 text-sm text-muted sm:gap-7">
            <Link href="/orders" className="transition-colors hover:text-ink">
              Orders
            </Link>
            <Link href="/store" className="transition-colors hover:text-ink">
              Sandbox store
            </Link>
          </nav>
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 px-5 py-10 sm:px-8 sm:py-16 ${width}`}>{children}</main>
      <footer className="border-t border-rule">
        <p className={`type-eyebrow mx-auto w-full px-5 py-5 text-faint sm:px-8 ${width}`}>
          PayPal sandbox · no real money moves
        </p>
      </footer>
    </div>
  );
}

type Tone = "green" | "red" | "amber" | "blue" | "gray";

const TONES: Record<Tone, string> = {
  green: "border-pos-line bg-pos-wash text-pos",
  red: "border-neg-line bg-neg-wash text-neg",
  amber: "border-warn-line bg-warn-wash text-warn",
  blue: "border-accent-line bg-accent-wash text-accent",
  gray: "border-rule-strong bg-sunk text-muted",
};

/** A status stamp: a dot and a mono, uppercase label on a squared hairline tag. */
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border px-1.5 py-1 font-mono text-[0.6875rem] font-medium uppercase leading-none tracking-[0.08em] ${TONES[tone]}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
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
  if (!action) return <span className="text-sm text-faint">No checks yet</span>;
  const a = ACTIONS[action] ?? { tone: "gray" as const, label: action };
  return <Pill tone={a.tone}>{a.label}</Pill>;
}

/** Ids, prices and scores are set in the mono face with tabular figures, so columns of numbers align. */
export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[0.92em] tabular-nums ${className}`}>{children}</span>;
}

/** A section opens with a hairline and an eyebrow label, instead of sitting in a box. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="type-eyebrow mb-5 border-t border-rule pt-4 text-muted">{children}</h2>;
}

const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45";

export const buttonPrimary = `${BUTTON_BASE} bg-ink text-paper hover:bg-ink-2`;
export const buttonQuiet = `${BUTTON_BASE} border border-rule-strong text-ink hover:bg-sunk`;
export const fieldClass =
  "w-full rounded-md border border-rule-strong bg-surface px-3.5 py-2.5 text-base text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

export function Notice({ tone = "gray", children }: { tone?: "gray" | "red" | "amber"; children: ReactNode }) {
  const styles = {
    gray: "border-rule-strong border-l-muted bg-sunk text-ink-2",
    red: "border-neg-line border-l-neg bg-neg-wash text-neg",
    amber: "border-warn-line border-l-warn bg-warn-wash text-warn",
  };
  return (
    <p
      role={tone === "red" ? "alert" : undefined}
      className={`rounded-sm border border-l-[3px] px-4 py-3 text-sm ${styles[tone]}`}
    >
      {children}
    </p>
  );
}
