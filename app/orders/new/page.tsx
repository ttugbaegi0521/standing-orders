import { NewOrderForm } from "../../_components/new-order-form";
import { Shell } from "../../_components/ui";

export default function NewOrderPage() {
  return (
    <Shell>
      <h1 className="type-title">New standing order</h1>
      <p className="mb-10 mt-3 max-w-xl text-muted">
        Describe it the way you would to a friend. You will see how it was understood before anything is watched.
      </p>
      <NewOrderForm />
    </Shell>
  );
}
