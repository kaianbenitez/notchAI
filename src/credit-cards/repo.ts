import { parseAmountToMinor } from "../money";
import { postTransaction, type Sql } from "../ledger/post";

export type CreditCardStatementStatus = "active" | "paid";

export interface CreditCardStatement {
  id: string;
  accountId: string;
  periodStartsOn: string;
  periodEndsOn: string;
  statementAmountMinor: number;
  dueOn: string;
  status: CreditCardStatementStatus;
  paidAt: Date | null;
  currentReminderRung: string | null;
}

export interface CreditCardActivity {
  id: string;
  occurredAt: string;
  payee: string | null;
  chargedMinor: number;
  creditMinor: number;
  personalExpenseMinor: number;
}

export class CreditCardStatementError extends Error {
  constructor(message: string) { super(message); this.name = "CreditCardStatementError"; }
}

function isoDate(value: string | Date): string { return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10); }

function assertDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new CreditCardStatementError(`${label} must be YYYY-MM-DD`);
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new CreditCardStatementError(`${label} is not a real calendar day`);
}

async function assertCreditCard(sql: Sql, userId: string, accountId: string): Promise<void> {
  const { rows } = await sql.query<{ name: string; role: string; kind: string; archived_at: Date | string | null }>(
    "select name, role, kind, archived_at from accounts where id = $1 and user_id = $2", [accountId, userId],
  );
  const card = rows[0];
  if (!card || card.role !== "liability" || card.kind !== "credit_card") throw new CreditCardStatementError("that account is not a credit card");
  if (card.archived_at !== null) throw new CreditCardStatementError(`\"${card.name}\" is archived`);
}

export function currentStatementPeriod(today: string, cutoffDay: number): { periodStartsOn: string; periodEndsOn: string } {
  assertDate(today, "today");
  const [year, month, day] = today.split("-").map(Number);
  const endYear = day >= cutoffDay ? year : month === 1 ? year - 1 : year;
  const endMonth = day >= cutoffDay ? month : month === 1 ? 12 : month - 1;
  const previousYear = endMonth === 1 ? endYear - 1 : endYear;
  const previousMonth = endMonth === 1 ? 12 : endMonth - 1;
  const format = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const start = new Date(Date.UTC(previousYear, previousMonth - 1, cutoffDay + 1));
  return { periodStartsOn: format(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()), periodEndsOn: format(endYear, endMonth, cutoffDay) };
}

export async function getCreditCardCutoff(sql: Sql, userId: string, accountId: string): Promise<number | null> {
  const { rows } = await sql.query<{ cutoff_day: number }>("select cutoff_day from credit_card_statement_settings where user_id = $1 and account_id = $2", [userId, accountId]);
  return rows[0] ? Number(rows[0].cutoff_day) : null;
}

export async function saveCreditCardCutoff(sql: Sql, userId: string, accountId: string, cutoffDay: number): Promise<void> {
  await assertCreditCard(sql, userId, accountId);
  if (!Number.isInteger(cutoffDay) || cutoffDay < 1 || cutoffDay > 28) throw new CreditCardStatementError("statement cutoff day must be from 1 to 28");
  await sql.query(
    `insert into credit_card_statement_settings (user_id, account_id, cutoff_day)
     values ($1, $2, $3)
     on conflict (user_id, account_id) do update set cutoff_day = excluded.cutoff_day, updated_at = now()`,
    [userId, accountId, cutoffDay],
  );
}

export async function listCreditCardActivity(sql: Sql, userId: string, accountId: string, periodStartsOn: string, periodEndsOn: string): Promise<CreditCardActivity[]> {
  const { rows } = await sql.query<{
    id: string; occurred_at: string | Date; payee: string | null; card_amount_minor: string | number; personal_expense_minor: string | number;
  }>(
    `select t.id, t.occurred_at, t.payee, card_entry.amount_minor as card_amount_minor,
            coalesce(sum(case when expense.role = 'expense' then entry.amount_minor else 0 end), 0)::bigint as personal_expense_minor
       from transactions t
       join entries card_entry on card_entry.transaction_id = t.id and card_entry.account_id = $2
       left join entries entry on entry.transaction_id = t.id
       left join accounts expense on expense.id = entry.account_id
      where t.user_id = $1 and t.status <> 'duplicate_merged'
        and t.occurred_at between $3::date and $4::date
      group by t.id, t.occurred_at, t.payee, card_entry.amount_minor
      order by t.occurred_at desc, t.id desc`,
    [userId, accountId, periodStartsOn, periodEndsOn],
  );
  return rows.map((row) => {
    const cardAmount = Number(row.card_amount_minor);
    return { id: row.id, occurredAt: isoDate(row.occurred_at), payee: row.payee, chargedMinor: Math.max(0, -cardAmount), creditMinor: Math.max(0, cardAmount), personalExpenseMinor: Number(row.personal_expense_minor) };
  });
}

interface StatementRow { id: string; account_id: string; period_starts_on: string | Date; period_ends_on: string | Date; statement_amount_minor: string | number; due_on: string | Date; status: CreditCardStatementStatus; paid_at: string | Date | null; current_reminder_rung: string | null; }
function toStatement(row: StatementRow): CreditCardStatement { return { id: row.id, accountId: row.account_id, periodStartsOn: isoDate(row.period_starts_on), periodEndsOn: isoDate(row.period_ends_on), statementAmountMinor: Number(row.statement_amount_minor), dueOn: isoDate(row.due_on), status: row.status, paidAt: row.paid_at === null ? null : new Date(row.paid_at), currentReminderRung: row.current_reminder_rung }; }

const STATEMENT_SELECT = `s.id, s.account_id, s.period_starts_on, s.period_ends_on, s.statement_amount_minor, s.due_on, s.status, s.paid_at,
  reminder.rung as current_reminder_rung`;

export async function listCreditCardStatements(sql: Sql, userId: string, accountId: string): Promise<CreditCardStatement[]> {
  const { rows } = await sql.query<StatementRow>(
    `select ${STATEMENT_SELECT} from credit_card_statements s
       left join lateral (select rung from credit_card_statement_reminders where statement_id = s.id order by fire_at desc limit 1) reminder on true
      where s.user_id = $1 and s.account_id = $2 order by s.period_ends_on desc`, [userId, accountId],
  );
  return rows.map(toStatement);
}

export async function createCreditCardStatement(sql: Sql, input: { userId: string; accountId: string; today: string; amount: string; dueOn: string }): Promise<CreditCardStatement> {
  await assertCreditCard(sql, input.userId, input.accountId);
  assertDate(input.today, "today"); assertDate(input.dueOn, "due date");
  const cutoff = await getCreditCardCutoff(sql, input.userId, input.accountId);
  if (!cutoff) throw new CreditCardStatementError("set this card's statement cutoff first");
  const amountMinor = parseAmountToMinor(input.amount);
  if (amountMinor <= 0) throw new CreditCardStatementError("statement balance must be greater than zero");
  const period = currentStatementPeriod(input.today, cutoff);
  const { rows: existing } = await sql.query<{ status: CreditCardStatementStatus; period_ends_on: string | Date }>(
    "select status, period_ends_on from credit_card_statements where user_id = $1 and account_id = $2 order by period_ends_on desc", [input.userId, input.accountId],
  );
  const samePeriod = existing.find((statement) => isoDate(statement.period_ends_on) === period.periodEndsOn);
  if (samePeriod?.status === "paid") throw new CreditCardStatementError("that statement period has already been paid");
  if (existing.some((statement) => statement.status === "active") && !samePeriod) throw new CreditCardStatementError("pay or correct the current statement before creating another one");
  const { rows } = await sql.query<StatementRow>(
    `insert into credit_card_statements (user_id, account_id, period_starts_on, period_ends_on, statement_amount_minor, due_on)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (user_id, account_id, period_ends_on) do update set statement_amount_minor = excluded.statement_amount_minor, due_on = excluded.due_on
     returning id, account_id, period_starts_on, period_ends_on, statement_amount_minor, due_on, status, paid_at, null::text as current_reminder_rung`,
    [input.userId, input.accountId, period.periodStartsOn, period.periodEndsOn, amountMinor, input.dueOn],
  );
  return toStatement(rows[0]);
}

export async function payCreditCardStatement(sql: Sql, input: { userId: string; statementId: string; fundingAccountId: string; paidOn: string }): Promise<string> {
  assertDate(input.paidOn, "payment date");
  const { rows } = await sql.query<{ id: string; account_id: string; statement_amount_minor: string | number; status: CreditCardStatementStatus; paid_transaction_id: string | null }>(
    "select id, account_id, statement_amount_minor, status, paid_transaction_id from credit_card_statements where id = $1 and user_id = $2 for update", [input.statementId, input.userId],
  );
  const statement = rows[0];
  if (!statement) throw new CreditCardStatementError("that card statement does not exist");
  if (statement.status === "paid") return statement.paid_transaction_id ?? "";
  await assertCreditCard(sql, input.userId, statement.account_id);
  const { rows: funding } = await sql.query<{ role: string; kind: string; archived_at: Date | string | null }>("select role, kind, archived_at from accounts where id = $1 and user_id = $2", [input.fundingAccountId, input.userId]);
  if (!funding[0] || funding[0].role !== "asset" || funding[0].kind === "category" || funding[0].archived_at !== null) throw new CreditCardStatementError("choose an active bank, e-wallet, or cash account");
  const amountMinor = Number(statement.statement_amount_minor);
  const transactionId = await postTransaction(sql, { userId: input.userId, occurredAt: input.paidOn, payee: "Credit card statement payment", memo: "Statement payment", source: "manual", status: "confirmed", sourceRef: `credit-card-statement:${statement.id}` }, [
    { accountId: input.fundingAccountId, amountMinor: -amountMinor }, { accountId: statement.account_id, amountMinor },
  ]);
  await sql.query("update credit_card_statements set status = 'paid', paid_at = now(), paid_transaction_id = $2 where id = $1", [statement.id, transactionId]);
  return transactionId;
}
