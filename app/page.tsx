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
      <section className="pb-12 pt-4 sm:pb-16 sm:pt-10">
        <h1 className="max-w-2xl type-display">Limit orders for shopping.</h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
          Tell an agent what you want and your price. It watches the market, buys with PayPal when a real deal
          qualifies, and refuses the fake ones.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/orders" className={`${buttonPrimary} px-5 py-2.5`}>
            Go to your orders →
          </Link>
          <Link href="/store" className={`${buttonQuiet} px-5 py-2.5`}>
            Visit the sandbox store
          </Link>
        </div>
      </section>

      <ol className="grid gap-4 sm:grid-cols-3">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="rounded-lg border border-rule bg-panel p-5">
            <span className="grid h-7 w-7 place-items-center rounded-md border border-rule bg-surface font-mono text-xs font-medium tabular-nums text-ink">
              {String(i + 1).padStart(2, "0")}
            </span>
            <h2 className="mt-4 type-heading">{title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ol>

      <section className="mt-4 overflow-hidden rounded-lg border border-rule bg-panel">
        <h2 className="type-eyebrow border-b border-rule px-5 py-3 text-muted">How it’s built</h2>
        <dl className="grid grid-cols-2 gap-px bg-rule sm:grid-cols-4">
          {STACK.map(([name, role]) => (
            <div key={name} className="bg-panel px-5 py-4">
              <dt className="text-[0.9375rem] font-semibold">{name}</dt>
              <dd className="mt-0.5 text-sm leading-relaxed text-muted">{role}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="mt-4 rounded-lg border border-rule bg-panel px-5 py-4 text-sm leading-relaxed text-ink-2">
        You set the limits: a cap per order, a monthly cap, the merchants you trust. Anything outside them comes
        back to you instead of being bought.
      </p>
    </Shell>
  );
}
