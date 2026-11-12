// Small shared pieces for the Standing Orders UI. Plain React + Tailwind; no component library.
// The look is an agent console: dark, square, bordered panels, mono labels and figures, one electric accent (cyan)
// for action and emphasis. Status colours (buy / hold / refuse) are semantic and always carry a text label.
import Link from "next/link";
import type { ReactNode } from "react";

export const ACCENT = "text-accent";

/** The mark: a price line dropping through a dashed limit, ending on the fill. */
function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden className="shrink-0">
      <line x1="1" x2="19" y1="10.5" y2="10.5" className="stroke-muted" strokeWidth="1.25" strokeDasharray="2 2.2" />
      <path d="M2 4.5 7.5 8 11 6 15 14" className="stroke-ink" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="15" cy="14" r="2.6" className="fill-accent" />
    </svg>
  );
}

const NAV_LINK =
  "transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

export function Shell({ children, width = "max-w-3xl" }: { children: ReactNode; width?: string }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg font-sans text-ink antialiased">
      <header className="border-b border-border bg-bg">
        <div className={`mx-auto flex w-full items-center justify-between gap-4 px-4 py-3.5 sm:px-6 ${width}`}>
          <Link
            href="/"
            className={`flex items-center gap-2.5 font-mono text-[0.8125rem] font-semibold uppercase leading-none tracking-[0.12em] text-ink ${NAV_LINK}`}
          >
            <Mark />
            Standing Orders
          </Link>
          <nav className="flex gap-5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted sm:gap-7">
            <Link href="/orders" className={NAV_LINK}>
              Orders
            </Link>
            <Link href="/store" className={NAV_LINK}>
              Sandbox store
            </Link>
          </nav>
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 px-4 py-8 sm:px-6 sm:py-12 ${width}`}>{children}</main>
      <footer className="border-t border-border">
        <p className={`type-eyebrow mx-auto w-full px-4 py-4 text-faint sm:px-6 ${width}`}>
          PayPal sandbox · no real money moves
        </p>
      </footer>
    </div>
  );
}

type Tone = "green" | "red" | "amber" | "blue" | "gray";

const TONES: Record<Tone, string> = {
  green: "bg-buy/10 text-buy",
  red: "bg-refuse/10 text-refuse",
  amber: "bg-hold/10 text-hold",
  blue: "bg-accent/10 text-accent",
  gray: "bg-panel-2 text-muted",
};

/** A status stamp: a bracketed, uppercase mono label with a leading dot, e.g. [ ● FILLED ]. */
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap px-1 py-0.5 font-mono text-[0.6875rem] font-semibold uppercase leading-none tracking-[0.1em] ${TONES[tone]}`}
    >
      <span aria-hidden className="opacity-60">
        [
      </span>
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {children}
      <span aria-hidden className="opacity-60">
        ]
      </span>
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
  if (!action) return <span className="font-mono text-xs text-muted">No checks yet</span>;
  const a = ACTIONS[action] ?? { tone: "gray" as const, label: action };
  return <Pill tone={a.tone}>{a.label}</Pill>;
}

/** Ids, prices and scores are set in the mono face with tabular figures, so columns of numbers align. */
export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[0.92em] tabular-nums ${className}`}>{children}</span>;
}

/**
 * A panel's header: an uppercase mono eyebrow over a hairline. `index` and `tag` name the pipeline stage the section
 * belongs to (01 PARSE, 02 SEARCH, ...); `aside` sits at the right edge.
 */
export function SectionTitle({
  children,
  index,
  tag,
  aside,
}: {
  children: ReactNode;
  index?: string;
  tag?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-2.5 sm:px-5">
      <h2 className="type-eyebrow flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-muted">
        {index && <span className="tabular-nums text-faint">{index}</span>}
        {tag && <span className="text-accent">{tag}</span>}
        {tag && (
          <span aria-hidden className="text-faint">
            /
          </span>
        )}
        <span className="text-ink-2">{children}</span>
      </h2>
      {aside && <div className="type-eyebrow text-muted">{aside}</div>}
    </div>
  );
}

/** A bordered, square content panel: the unit every page is built from. */
export function Panel({
  title,
  index,
  tag,
  aside,
  id,
  className = "",
  bodyClassName = "px-4 py-5 sm:px-5",
  children,
}: {
  title?: ReactNode;
  index?: string;
  tag?: string;
  aside?: ReactNode;
  id?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`min-w-0 border border-border bg-panel ${className}`}>
      {title && (
        <SectionTitle index={index} tag={tag} aside={aside}>
          {title}
        </SectionTitle>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-[4px] px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.08em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40";

export const buttonPrimary = `${BUTTON_BASE} border border-accent bg-accent text-bg hover:bg-accent/85`;
export const buttonQuiet = `${BUTTON_BASE} border border-border bg-panel-2 text-ink hover:border-border-strong hover:text-accent`;
export const fieldClass =
  "w-full rounded-[4px] border border-border bg-panel-2 px-3.5 py-2.5 text-base text-ink placeholder:text-muted hover:border-border-strong focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent/50";

export function Notice({ tone = "gray", children }: { tone?: "gray" | "red" | "amber"; children: ReactNode }) {
  const styles = {
    gray: "border-l-accent text-ink-2",
    red: "border-l-refuse text-refuse",
    amber: "border-l-hold text-hold",
  };
  return (
    <p
      role={tone === "red" ? "alert" : undefined}
      className={`border border-l-2 border-border bg-panel px-4 py-3 text-sm leading-relaxed ${styles[tone]}`}
    >
      {children}
    </p>
  );
}
