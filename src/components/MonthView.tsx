import Link from "next/link";

import { formatPeso } from "../money";
import type { MonthCategoryTotal, MonthSummary, MonthTransaction } from "../transactions/month";
import type { CategoryBudgetProgress } from "../budgets/progress";

interface Props {
  month: string;
  previousMonth: string;
  nextMonth: string;
  summary: MonthSummary;
  categories: MonthCategoryTotal[];
  transactions: MonthTransaction[];
  budgets: CategoryBudgetProgress[];
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

function signedPeso(amountMinor: number): string {
  return amountMinor > 0 ? `+${formatPeso(amountMinor)}` : formatPeso(amountMinor);
}

function CategoryGroup({ title, categories }: { title: string; categories: MonthCategoryTotal[] }) {
  return (
    <section>
      <h2 className="text-lg font-medium text-slate-100">{title}</h2>
      {categories.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No {title.toLowerCase()} this month.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-800 rounded-lg border border-slate-800">
          {categories.map((category) => (
            <li key={`${category.role}:${category.name}`} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span className="text-slate-200">{category.name}</span>
              <span className="tabular-nums text-slate-300">{formatPeso(category.amountMinor)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MonthView({ month, previousMonth, nextMonth, summary, categories, transactions, budgets }: Props) {
  const expenses = categories.filter((category) => category.role === "expense");
  const income = categories.filter((category) => category.role === "income");

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <Link href={`/month?m=${previousMonth}`} className="text-sm text-slate-400 transition-colors hover:text-slate-100">
          ← Previous
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{monthLabel(month)}</h1>
        <Link href={`/month?m=${nextMonth}`} className="text-sm text-slate-400 transition-colors hover:text-slate-100">
          Next →
        </Link>
      </div>

      {transactions.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-500">
          Nothing logged this month.
        </p>
      ) : (
        <>
          <dl className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-800 px-4 py-3">
              <dt className="text-sm text-slate-400">Income</dt>
              <dd className="mt-1 tabular-nums text-lg font-medium text-emerald-400">{formatPeso(summary.incomeMinor)}</dd>
            </div>
            <div className="rounded-lg border border-slate-800 px-4 py-3">
              <dt className="text-sm text-slate-400">Expenses</dt>
              <dd className="mt-1 tabular-nums text-lg font-medium text-slate-100">{formatPeso(summary.expenseMinor)}</dd>
            </div>
            <div className="rounded-lg border border-slate-800 px-4 py-3">
              <dt className="text-sm text-slate-400">Net</dt>
              <dd className="mt-1 tabular-nums text-lg font-medium text-slate-100">{formatPeso(summary.netMinor)}</dd>
            </div>
          </dl>

          <div className="mt-10 grid gap-8 sm:grid-cols-2">
            <CategoryGroup title="Expenses by category" categories={expenses} />
            <CategoryGroup title="Income by category" categories={income} />
          </div>

          <section className="mt-10">
            <h2 className="text-lg font-medium text-slate-100">Transactions</h2>
            <ul className="mt-3 divide-y divide-slate-800 rounded-lg border border-slate-800">
              {transactions.map((transaction) => (
                <li key={transaction.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                  <span className="w-20 text-slate-400">{transaction.occurredAt}</span>
                  <span className="min-w-32 flex-1 text-slate-100">{transaction.payee ?? "No payee"}</span>
                  <span className="text-slate-400">{transaction.category}</span>
                  <span className="text-slate-400">{transaction.account}</span>
                  <span className="ml-auto tabular-nums text-slate-200">{signedPeso(transaction.amountMinor)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {budgets.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-medium text-slate-100">Budgets</h2>
          <ul className="mt-3 divide-y divide-slate-800 rounded-lg border border-slate-800">
            {budgets.map((budget) => (
              <li key={budget.budgetId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <span className="min-w-32 flex-1 text-slate-200">{budget.categoryName}</span>
                <span className="tabular-nums text-slate-400">Budget {formatPeso(budget.budgetedMinor)}</span>
                <span className="tabular-nums text-slate-400">Spent {formatPeso(budget.spentMinor)}</span>
                <span className={`tabular-nums ${budget.remainingMinor < 0 ? "text-rose-400" : "text-emerald-400"}`}>{formatPeso(budget.remainingMinor)} left</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
