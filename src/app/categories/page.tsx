import { listAccounts } from "../../accounts/repo";
import { currentUserId } from "../../auth";
import { AccountManager, type TypeOption } from "../../components/AccountManager";
import { withDb } from "../../db/client";

export const dynamic = "force-dynamic";

const TYPES: TypeOption[] = [
  { value: "expense:category", label: "Expense" },
  { value: "income:category", label: "Income" },
];

export default async function CategoriesPage() {
  const categories = await withDb((sql) =>
    listAccounts(sql, currentUserId(), {
      roles: ["expense", "income"],
      includeArchived: true,
    }),
  );

  return (
    <AccountManager
      title="Categories"
      blurb="Categories are accounts too, which is why a split charges your share to the budget and nothing more. Totals are all-time; the month view comes next."
      accounts={categories}
      typeOptions={TYPES}
      nestable
      emptyMessage="No categories yet. Start with the handful you actually spend on."
    />
  );
}
