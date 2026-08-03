import type { Sql } from "../ledger/post";

export interface MonthSummary {
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
}

export interface MonthCategoryTotal {
  name: string;
  role: "expense" | "income";
  amountMinor: number;
}

export interface MonthTransaction {
  id: string;
  occurredAt: string;
  payee: string | null;
  category: string;
  account: string;
  /** Signed from the user's perspective: out is negative, in is positive. */
  amountMinor: number;
}

function toIsoDate(value: string | Date): string {
  if (typeof value === "string") return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Plain DATE boundaries for a calendar month: [first day, first day of next month). */
export function monthBounds(month: string): { start: string; end: string } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new Error(`month must be YYYY-MM, got ${month}`);

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return {
    start: `${match[1]}-${match[2]}-01`,
    end: `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

export async function getMonthSummary(
  sql: Sql,
  userId: string,
  month: string,
): Promise<MonthSummary> {
  const { start, end } = monthBounds(month);
  const { rows } = await sql.query<{
    income_minor: string | number;
    expense_minor: string | number;
  }>(
    `select coalesce(sum(case when category.role = 'income' then -category_entry.base_amount_minor else 0 end), 0)::bigint as income_minor,
            coalesce(sum(case when category.role = 'expense' then category_entry.base_amount_minor else 0 end), 0)::bigint as expense_minor
       from transactions t
       join entries category_entry on category_entry.transaction_id = t.id
       join accounts category on category.id = category_entry.account_id
      where t.user_id = $1
        and t.occurred_at >= $2 and t.occurred_at < $3
        and t.status <> 'duplicate_merged'
        and category.role in ('expense', 'income')
        and category.kind = 'category'`,
    [userId, start, end],
  );
  const incomeMinor = Number(rows[0].income_minor);
  const expenseMinor = Number(rows[0].expense_minor);
  return { incomeMinor, expenseMinor, netMinor: incomeMinor - expenseMinor };
}

export async function listMonthCategoryTotals(
  sql: Sql,
  userId: string,
  month: string,
): Promise<MonthCategoryTotal[]> {
  const { start, end } = monthBounds(month);
  const { rows } = await sql.query<{
    name: string;
    role: "expense" | "income";
    amount_minor: string | number;
  }>(
    `select category.name, category.role,
            abs(sum(category_entry.base_amount_minor))::bigint as amount_minor
       from transactions t
       join entries category_entry on category_entry.transaction_id = t.id
       join accounts category on category.id = category_entry.account_id
      where t.user_id = $1
        and t.occurred_at >= $2 and t.occurred_at < $3
        and t.status <> 'duplicate_merged'
        and category.role in ('expense', 'income')
        and category.kind = 'category'
      group by category.id, category.name, category.role
     having sum(category_entry.base_amount_minor) <> 0
      order by amount_minor desc, category.name`,
    [userId, start, end],
  );
  return rows.map((row) => ({
    name: row.name,
    role: row.role,
    amountMinor: Number(row.amount_minor),
  }));
}

export async function listMonthTransactions(
  sql: Sql,
  userId: string,
  month: string,
): Promise<MonthTransaction[]> {
  const { start, end } = monthBounds(month);
  const { rows } = await sql.query<{
    id: string;
    occurred_at: string | Date;
    payee: string | null;
    category: string;
    account: string;
    amount_minor: string | number;
  }>(
    `select t.id, t.occurred_at, t.payee, category.name as category,
            account.name as account, -category_entry.base_amount_minor as amount_minor
       from transactions t
       join entries category_entry on category_entry.transaction_id = t.id
       join accounts category on category.id = category_entry.account_id
       join entries account_entry on account_entry.transaction_id = t.id
       join accounts account on account.id = account_entry.account_id
      where t.user_id = $1
        and t.occurred_at >= $2 and t.occurred_at < $3
        and t.status <> 'duplicate_merged'
        and category.role in ('expense', 'income')
        and category.kind = 'category'
        and account.role in ('asset', 'liability')
        and account.kind <> 'category'
      order by t.occurred_at desc, t.created_at desc`,
    [userId, start, end],
  );
  return rows.map((row) => ({
    id: row.id,
    occurredAt: toIsoDate(row.occurred_at),
    payee: row.payee,
    category: row.category,
    account: row.account,
    amountMinor: Number(row.amount_minor),
  }));
}
