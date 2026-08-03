import type { Sql } from "../ledger/post";
import { monthBounds } from "../transactions/month";

export interface CategoryBudgetProgress {
  budgetId: string;
  categoryId: string;
  categoryName: string;
  rolloverEnabled: boolean;
  budgetedMinor: number;
  spentMinor: number;
  remainingMinor: number;
}

interface BudgetRow { id: string; account_id: string; category_name: string; amount_minor: string | number; rollover_enabled: boolean; starts_on: string | Date; }

function monthOf(value: string | Date): string {
  return (typeof value === "string" ? value : value.toISOString()).slice(0, 7);
}

function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5, 7));
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
}

async function spendForMonth(sql: Sql, userId: string, categoryId: string, month: string): Promise<number> {
  const { start, end } = monthBounds(month);
  const { rows } = await sql.query<{ spent_minor: string | number }>(
    `select coalesce(sum(e.base_amount_minor), 0)::bigint as spent_minor
       from entries e join transactions t on t.id = e.transaction_id
      where e.account_id = $1 and t.user_id = $2 and t.occurred_at >= $3 and t.occurred_at < $4
        and t.status <> 'duplicate_merged'`,
    [categoryId, userId, start, end],
  );
  return Number(rows[0].spent_minor);
}

export async function getMonthBudgetProgress(sql: Sql, userId: string, month: string): Promise<CategoryBudgetProgress[]> {
  monthBounds(month);
  const { rows } = await sql.query<BudgetRow>(
    `select b.id, b.account_id, a.name as category_name, b.amount_minor, b.rollover_enabled, b.starts_on
       from budgets b join accounts a on a.id = b.account_id
      where b.user_id = $1 and b.archived_at is null and b.starts_on <= $2::date
      order by a.name`,
    [userId, `${month}-01`],
  );
  return Promise.all(rows.map(async (budget) => {
    const amountMinor = Number(budget.amount_minor);
    const startsOn = monthOf(budget.starts_on);
    if (!budget.rollover_enabled) {
      const spentMinor = await spendForMonth(sql, userId, budget.account_id, month);
      return { budgetId: budget.id, categoryId: budget.account_id, categoryName: budget.category_name, rolloverEnabled: false, budgetedMinor: amountMinor, spentMinor, remainingMinor: amountMinor - spentMinor };
    }
    let cursor = startsOn;
    let carry = 0;
    let count = 0;
    let budgetedMinor = amountMinor;
    let spentMinor = 0;
    while (true) {
      if (++count > 1200) throw new Error("budget rollover exceeds 1200 months");
      budgetedMinor = amountMinor + carry;
      spentMinor = await spendForMonth(sql, userId, budget.account_id, cursor);
      carry = budgetedMinor - spentMinor;
      if (cursor === month) break;
      cursor = nextMonth(cursor);
    }
    return { budgetId: budget.id, categoryId: budget.account_id, categoryName: budget.category_name, rolloverEnabled: true, budgetedMinor, spentMinor, remainingMinor: carry };
  }));
}
