import { NewOrderForm } from "../../_components/new-order-form";
import { Shell } from "../../_components/ui";

export default function NewOrderPage() {
  return (
    <Shell>
      <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">New standing order</h1>
      <p className="mb-10 mt-3 max-w-xl text-[#6b6a64]">
        Describe it the way you would to a friend. You will see how it was understood before anything is watched.
      </p>
      <NewOrderForm />
    </Shell>
  );
}
