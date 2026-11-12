import { NewOrderForm } from "../../_components/new-order-form";
import { PageHeader, Shell } from "../../_components/ui";

export default function NewOrderPage() {
  return (
    <Shell>
      <PageHeader
        title="New standing order"
        description="Describe it the way you would to a friend. You will see how it was understood before anything is watched."
      />
      <NewOrderForm />
    </Shell>
  );
}
