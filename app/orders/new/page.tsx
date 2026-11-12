import { NewOrderForm } from "../../_components/new-order-form";
import { Shell } from "../../_components/ui";

export default function NewOrderPage() {
  return (
    <Shell>
      <p className="type-eyebrow mb-3 text-accent">01 Parse</p>
      <h1 className="type-title">New standing order</h1>
      <p className="mb-8 mt-3 max-w-xl border-b border-border pb-8 text-ink-2">
        Describe it the way you would to a friend. You will see how it was understood before anything is watched.
      </p>
      <NewOrderForm />
    </Shell>
  );
}
