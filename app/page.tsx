export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Standing Orders</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Limit orders for shopping. Tell the agent what you want and your limits; it watches prices,
        refuses fake sales, and buys with PayPal when the deal is real.
      </p>
    </main>
  );
}
