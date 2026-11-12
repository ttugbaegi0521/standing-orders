import Link from "next/link";
import { Shell, buttonPrimary, buttonQuiet } from "./_components/ui";

const STEPS = [
  ["Say what you want", "Plain language and a price. The agent turns it into a spec you confirm."],
  ["It watches", "Prices are checked on a schedule, scored against your spec, and compared with their own history."],
  ["It buys, or refuses", "Real deals go to you for one-tap PayPal approval. Fake sales are skipped, with the reasoning shown."],
];

const STACK = [
  ["PayPal", "Orders + capture"],
  ["Claude", "parses, scores, decides"],
  ["Channel3", "live product data"],
  ["Render", "scheduled watching"],
];

export default function Home() {
  return (
    <Shell width="max-w-5xl">
      <section className="border border-border bg-panel">
        <div className="border-b border-border px-4 py-2.5 sm:px-8">
          <p className="type-eyebrow flex items-center gap-2 text-ink-2">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
            Standing Orders
          </p>
        </div>
        <div className="px-4 py-10 sm:px-8 sm:py-14">
          <p aria-hidden className="mb-4 font-mono text-sm text-accent">
            &gt;_
          </p>
          <h1 className="max-w-3xl type-display">
            Limit orders for shopping.
            <span
              aria-hidden
              className="cursor-blink ml-2 inline-block h-[0.8em] w-[0.42em] translate-y-[0.06em] bg-accent align-baseline"
            />
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2">
            Tell an agent what you want and your price. It watches the market, buys with PayPal when a real deal
            qualifies, and refuses the fake ones.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/orders" className={`${buttonPrimary} px-6 py-3`}>
              Go to your orders →
            </Link>
            <Link href="/store" className={`${buttonQuiet} px-6 py-3`}>
              Visit the sandbox store
            </Link>
          </div>
        </div>

        <div className="border-t border-border bg-bg/40 px-4 py-4 sm:px-8">
          <h2 className="type-eyebrow text-muted">How it’s built</h2>
          <dl className="mt-3 flex flex-col gap-y-2 font-mono text-[0.8125rem] lg:flex-row lg:flex-wrap lg:items-baseline">
            {STACK.map(([name, role], i) => (
              <div key={name} className="flex items-baseline gap-2">
                <dt className="font-semibold uppercase tracking-[0.1em] text-accent">{name}</dt>
                <dd className="text-ink-2">{role}</dd>
                {i < STACK.length - 1 && (
                  <span aria-hidden className="hidden px-3 text-faint lg:inline">
                    ·
                  </span>
                )}
              </div>
            ))}
          </dl>
        </div>
      </section>

      <ol className="mt-4 grid gap-px border border-border bg-border sm:grid-cols-3">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="bg-panel px-4 py-5 sm:px-5">
            <span className="font-mono text-xs tabular-nums text-accent">{String(i + 1).padStart(2, "0")}</span>
            <h2 className="mt-3 font-mono text-sm font-semibold uppercase tracking-[0.08em] text-ink">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ol>

      <p className="mt-4 border border-l-2 border-border border-l-hold bg-panel px-4 py-3 text-sm leading-relaxed text-ink-2 sm:px-5">
        You set the limits: a cap per order, a monthly cap, the merchants you trust. Anything outside them comes
        back to you instead of being bought.
      </p>
    </Shell>
  );
}
