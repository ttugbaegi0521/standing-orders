// Small shared pieces for the Standing Orders UI. Plain React + Tailwind; no component library.
// Colours and the type scale are tokens defined in app/globals.css: a white page, content contained in faint gray
// cards with hairline borders, and one accent (indigo) reserved for primary actions, the active pipeline stage and
// the price line. Status colours (pos / warn / neg) always carry a text label.
import Link from "next/link";
import type { ReactNode } from "react";

export const ACCENT = "text-accent";

/** The mark: a price line dropping through a dashed limit, ending on the fill, set in a small ink tile. */
function Mark() {
  return (
    <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink">
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <line x1="1" x2="19" y1="10.5" y2="10.5" className="stroke-faint" strokeWidth="1.25" strokeDasharray="2 2.2" />
        <path d="M2 4.5 7.5 8 11 6 15 14" className="stroke-paper" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="15" cy="14" r="2.6" className="fill-accent-line" />
      </svg>
    </span>
  );
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function Shell({ children, width = "max-w-3xl" }: { children: ReactNode; width?: string }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper font-sans text-ink antialiased">
      <header className="sticky top-0 z-10 border-b border-rule bg-paper/90 backdrop-blur">
        <div className={`mx-auto flex h-14 w-full items-center justify-between gap-4 px-4 sm:px-6 ${width}`}>
          <Link href="/" className={`flex items-center gap-2.5 rounded-md text-[0.9375rem] font-semibold tracking-tight ${FOCUS}`}>
            <Mark />
            Standing Orders
          </Link>
          <nav className="flex items-center gap-1 text-sm font-medium text-muted">
            <Link href="/orders" className={`rounded-md px-2.5 py-1.5 transition-colors hover:bg-sunk hover:text-ink ${FOCUS}`}>
              Orders
            </Link>
            <Link href="/store" className={`rounded-md px-2.5 py-1.5 transition-colors hover:bg-sunk hover:text-ink ${FOCUS}`}>
              Sandbox store
            </Link>
          </nav>
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 px-4 py-8 sm:px-6 sm:py-12 ${width}`}>{children}</main>
      <footer className="border-t border-rule">
        <p className={`mx-auto w-full px-4 py-5 text-xs text-muted sm:px-6 ${width}`}>PayPal sandbox · no real money moves</p>
      </footer>
    </div>
  );
}

/** The top of every page: one title size, an optional line of description, and actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 max-w-2xl">
        {meta && <div className="mb-3 flex flex-wrap items-center gap-2.5">{meta}</div>}
        <h1 className="type-title">{title}</h1>
        {description && <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

type Tone = "green" | "red" | "amber" | "blue" | "gray";

const TONES: Record<Tone, string> = {
  green: "bg-pos-wash text-pos ring-pos-line",
  red: "bg-neg-wash text-neg ring-neg-line",
  amber: "bg-warn-wash text-warn ring-warn-line",
  blue: "bg-accent-wash text-accent ring-accent-line",
  gray: "bg-sunk text-ink-2 ring-rule-strong",
};

/** A status pill: small, solid-filled, rounded, with a medium-weight label. */
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium leading-5 ring-1 ring-inset ${TONES[tone]}`}
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
  if (!action) return <span className="text-sm text-muted">No checks yet</span>;
  const a = ACTIONS[action] ?? { tone: "gray" as const, label: action };
  return <Pill tone={a.tone}>{a.label}</Pill>;
}

/** Ids, prices and scores are set in the mono face with tabular figures, so columns of numbers align. */
export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[0.92em] tabular-nums ${className}`}>{children}</span>;
}

/** A card's header row: an uppercase section label on the left, optional detail on the right, a hairline below. */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-rule px-5 py-3">
      <h2 className="type-eyebrow text-muted">{children}</h2>
      {aside && <div className="text-xs text-muted">{aside}</div>}
    </div>
  );
}

/** A contained section: a faint raised panel with a 1px hairline and 8px corners. Every page is built from these. */
export function Card({
  title,
  aside,
  id,
  className = "",
  bodyClassName = "p-5",
  children,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  id?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`min-w-0 overflow-hidden rounded-lg border border-rule bg-panel ${className}`}>
      {title && <SectionTitle aside={aside}>{title}</SectionTitle>}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

const BUTTON_BASE = `inline-flex items-center justify-center rounded-md px-3.5 py-2 text-sm font-medium shadow-xs transition-colors ${FOCUS} disabled:cursor-not-allowed disabled:opacity-50`;

export const buttonPrimary = `${BUTTON_BASE} bg-accent text-paper hover:bg-accent-strong`;
export const buttonQuiet = `${BUTTON_BASE} border border-rule-strong bg-surface text-ink hover:bg-sunk`;
export const fieldClass =
  "w-full rounded-md border border-rule-strong bg-surface px-3 py-2 text-[0.9375rem] text-ink shadow-xs placeholder:text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/15";

export function Notice({ tone = "gray", children }: { tone?: "gray" | "red" | "amber"; children: ReactNode }) {
  const styles = {
    gray: "border-rule bg-panel text-ink-2",
    red: "border-neg-line bg-neg-wash text-neg",
    amber: "border-warn-line bg-warn-wash text-warn",
  };
  return (
    <p role={tone === "red" ? "alert" : undefined} className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${styles[tone]}`}>
      {children}
    </p>
  );
}
