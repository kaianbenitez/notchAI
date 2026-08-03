import type { Sql } from "../ledger/post";

export interface Budget {
  id: string;
  userId: string;
  accountId: string;
  categoryName: string;
  amountMinor: number;
  currency: string;
  rolloverEnabled: boolean;
  startsOn: string;
  archivedAt: Date | null;
}

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetError";
  }
}

interface BudgetRow {
  id: string;
  user_id: string;
  account_id: string;
  category_name: string;
  amount_minor: string | number;
  currency: string;
  rollover_enabled: boolean;
  starts_on: string | Date;
  archived_at: string | Date | null;
}

function isoDate(value: string | Date): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function toBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    categoryName: row.category_name,
    amountMinor: Number(row.amount_minor),
    currency: row.currency.trim(),
    rolloverEnabled: row.rollover_enabled,
    startsOn: isoDate(row.starts_on).slice(0, 7),
    archivedAt: row.archived_at === null ? null : new Date(row.archived_at),
  };
}

function assertAmount(amountMinor: number): void {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new BudgetError("a budget amount must be a positive whole number of centavos");
  }
}

function assertMonth(month: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new BudgetError("budget start month must be YYYY-MM");
  }
}

const SELECT_BUDGET = `
  b.id, b.user_id, b.account_id, a.name as category_name, b.amount_minor,
  b.currency, b.rollover_enabled, b.starts_on, b.archived_at
`;

export async function createBudget(
  sql: Sql,
  input: {
    userId: string;
    accountId: string;
    amountMinor: number;
    currency?: string;
    rolloverEnabled?: boolean;
    startsOn: string;
  },
): Promise<Budget> {
  assertAmount(input.amountMinor);
  assertMonth(input.startsOn);
  const currency = (input.currency ?? "PHP").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new BudgetError(`"${currency}" is not a three-letter currency code`);

  const { rows: accounts } = await sql.query<{ name: string; role: string; kind: string; archived_at: Date | string | null }>(
    `select name, role, kind, archived_at from accounts where id = $1 and user_id = $2`,
    [input.accountId, input.userId],
  );
  const account = accounts[0];
  if (!account) throw new BudgetError("that category does not exist");
  if (account.role !== "expense" || account.kind !== "category") {
    throw new BudgetError(`"${account.name}" is not an expense category`);
  }
  if (account.archived_at !== null) throw new BudgetError(`"${account.name}" is archived`);

  const { rows: active } = await sql.query<{ id: string }>(
    `select id from budgets where user_id = $1 and account_id = $2 and archived_at is null limit 1`,
    [input.userId, input.accountId],
  );
  if (active[0]) throw new BudgetError(`you already have a budget for "${account.name}"`);

  const { rows } = await sql.query<BudgetRow>(
    `insert into budgets (user_id, account_id, amount_minor, currency, rollover_enabled, starts_on)
     values ($1, $2, $3, $4, $5, $6)
     returning id, user_id, account_id, $7::text as category_name, amount_minor, currency, rollover_enabled, starts_on, archived_at`,
    [input.userId, input.accountId, input.amountMinor, currency, input.rolloverEnabled ?? false, `${input.startsOn}-01`, account.name],
  );
  return toBudget(rows[0]);
}

export async function listBudgets(sql: Sql, userId: string, options: { includeArchived?: boolean } = {}): Promise<Budget[]> {
  const { rows } = await sql.query<BudgetRow>(
    `select ${SELECT_BUDGET} from budgets b join accounts a on a.id = b.account_id
      where b.user_id = $1 and ($2::boolean or b.archived_at is null)
      order by a.name`,
    [userId, options.includeArchived ?? false],
  );
  return rows.map(toBudget);
}

export async function getBudget(sql: Sql, userId: string, id: string): Promise<Budget | null> {
  const { rows } = await sql.query<BudgetRow>(
    `select ${SELECT_BUDGET} from budgets b join accounts a on a.id = b.account_id
      where b.id = $1 and b.user_id = $2`,
    [id, userId],
  );
  return rows[0] ? toBudget(rows[0]) : null;
}

export async function updateBudget(sql: Sql, userId: string, id: string, changes: { amountMinor?: number; rolloverEnabled?: boolean }): Promise<Budget> {
  const existing = await getBudget(sql, userId, id);
  if (!existing) throw new BudgetError("that budget does not exist");
  const amountMinor = changes.amountMinor ?? existing.amountMinor;
  assertAmount(amountMinor);
  const { rows } = await sql.query<BudgetRow>(
    `update budgets b set amount_minor = $3, rollover_enabled = $4
      from accounts a where b.id = $1 and b.user_id = $2 and a.id = b.account_id
      returning ${SELECT_BUDGET}`,
    [id, userId, amountMinor, changes.rolloverEnabled ?? existing.rolloverEnabled],
  );
  return toBudget(rows[0]);
}

export async function archiveBudget(sql: Sql, userId: string, id: string): Promise<Budget> {
  const { rows } = await sql.query<BudgetRow>(
    `update budgets b set archived_at = now() from accounts a
      where b.id = $1 and b.user_id = $2 and a.id = b.account_id and b.archived_at is null
      returning ${SELECT_BUDGET}`,
    [id, userId],
  );
  if (rows[0]) return toBudget(rows[0]);
  const existing = await getBudget(sql, userId, id);
  if (!existing) throw new BudgetError("that budget does not exist");
  return existing;
}

/** Restore an archived budget when its category has no newer live budget. */
export async function unarchiveBudget(sql: Sql, userId: string, id: string): Promise<Budget> {
  const existing = await getBudget(sql, userId, id);
  if (!existing) throw new BudgetError("that budget does not exist");
  if (existing.archivedAt === null) return existing;
  const { rows: active } = await sql.query<{ id: string }>(
    `select id from budgets where user_id = $1 and account_id = $2 and archived_at is null limit 1`,
    [userId, existing.accountId],
  );
  if (active[0]) throw new BudgetError(`you already have a budget for "${existing.categoryName}"`);
  const { rows } = await sql.query<BudgetRow>(
    `update budgets b set archived_at = null from accounts a
      where b.id = $1 and b.user_id = $2 and a.id = b.account_id
      returning ${SELECT_BUDGET}`,
    [id, userId],
  );
  return toBudget(rows[0]);
}
