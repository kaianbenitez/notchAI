import { listAccounts } from "../../accounts/repo";
import { listBudgets } from "../../budgets/repo";
import { currentUserId } from "../../auth";
import { BudgetManager } from "../../components/BudgetManager";
import { withDb } from "../../db/client";

export const dynamic = "force-dynamic";

function manilaMonth(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit" }).format(new Date()); }

export default async function BudgetsPage() {
  const userId = currentUserId();
  const [budgets, categories] = await withDb((sql) => Promise.all([listBudgets(sql, userId, { includeArchived: true }), listAccounts(sql, userId, { roles: ["expense"] })]));
  return <BudgetManager budgets={budgets} categories={categories} currentMonth={manilaMonth()} />;
}
