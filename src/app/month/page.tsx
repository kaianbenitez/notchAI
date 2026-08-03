import { currentUserId } from "../../auth";
import { MonthView } from "../../components/MonthView";
import { withDb } from "../../db/client";
import { getMonthSummary, listMonthCategoryTotals, listMonthTransactions } from "../../transactions/month";

export const dynamic = "force-dynamic";

function manilaMonth(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit",
  }).format(new Date());
}

function validMonth(value: string | undefined): value is string {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? "");
}

function adjacentMonth(month: string, direction: -1 | 1): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7)) + direction;
  const nextYear = monthNumber === 0 ? year - 1 : monthNumber === 13 ? year + 1 : year;
  const nextMonth = monthNumber === 0 ? 12 : monthNumber === 13 ? 1 : monthNumber;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
}

export default async function MonthPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const params = await searchParams;
  const month = validMonth(params.m) ? params.m : manilaMonth();
  const userId = currentUserId();
  const [summary, categories, transactions] = await withDb((sql) => Promise.all([
    getMonthSummary(sql, userId, month),
    listMonthCategoryTotals(sql, userId, month),
    listMonthTransactions(sql, userId, month),
  ]));

  return (
    <MonthView
      month={month}
      previousMonth={adjacentMonth(month, -1)}
      nextMonth={adjacentMonth(month, 1)}
      summary={summary}
      categories={categories}
      transactions={transactions}
    />
  );
}
