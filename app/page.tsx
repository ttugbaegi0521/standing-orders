import Link from "next/link";
import { Shell, buttonPrimary } from "./_components/ui";

const STEPS = [
  ["Say what you want", "Plain language and a price. The agent turns it into a spec you confirm."],
  ["It watches", "Prices are checked on a schedule, scored against your spec, and compared with their own history."],
  ["It buys, or refuses", "Real deals go to you for one-tap PayPal approval. Fake sales are skipped, with the reasoning shown."],
];

export default function Home() {
  return (
    <Shell>
      <section className="pt-6 sm:pt-12">
        <h1 className="max-w-2xl font-serif text-4xl leading-[1.12] tracking-tight sm:text-5xl">
          Limit orders for shopping — tell an agent what you want and your price; it watches and buys when it
          qualifies.
        </h1>
        <div className="mt-9">
          <Link href="/orders" className={`${buttonPrimary} px-7 py-3 text-base`}>
            Go to your orders →
          </Link>
        </div>
      </section>

      <ol className="mt-20 grid gap-10 border-t border-[#e7e5df] pt-10 sm:grid-cols-3">
        {STEPS.map(([title, body], i) => (
          <li key={title}>
            <span className="font-mono text-sm text-[#2748d4]">{String(i + 1).padStart(2, "0")}</span>
            <h2 className="mt-2 font-serif text-xl">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#6b6a64]">{body}</p>
          </li>
        ))}
      </ol>

      <p className="mt-16 max-w-xl text-sm leading-relaxed text-[#6b6a64]">
        You set the limits: a cap per order, a monthly cap, the merchants you trust. Anything outside them comes
        back to you instead of being bought.
      </p>
    </Shell>
  );
}
