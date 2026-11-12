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
    <Shell>
      <section className="pt-6 sm:pt-12">
        <h1 className="max-w-2xl type-display">
          Limit orders for shopping.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-2">
          Tell an agent what you want and your price. It watches the market, buys with PayPal when a real deal
          qualifies, and refuses the fake ones.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <Link href="/orders" className={`${buttonPrimary} px-7 py-3 text-base`}>
            Go to your orders →
          </Link>
          <Link href="/store" className={`${buttonQuiet} px-7 py-3 text-base`}>
            Visit the sandbox store
          </Link>
        </div>
      </section>

      <ol className="mt-20 grid gap-10 border-t border-rule pt-10 sm:grid-cols-3">
        {STEPS.map(([title, body], i) => (
          <li key={title}>
            <span className="font-mono text-sm text-accent">{String(i + 1).padStart(2, "0")}</span>
            <h2 className="mt-2 font-serif text-xl">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ol>

      <section className="mt-16 border-t border-rule pt-10">
        <h2 className="type-eyebrow text-muted">How it’s built</h2>
        <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
          {STACK.map(([name, role]) => (
            <div key={name}>
              <dt className="type-heading">{name}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted">{role}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="mt-16 max-w-xl text-sm leading-relaxed text-muted">
        You set the limits: a cap per order, a monthly cap, the merchants you trust. Anything outside them comes
        back to you instead of being bought.
      </p>
    </Shell>
  );
}
