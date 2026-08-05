import type { Sql } from "../ledger/post";
import { nextOccurrence, recurrencePresetToRrule, rruleToRecurrencePreset, type RecurrencePreset } from "./recurrence";

export interface ReminderRule {
  id: string;
  userId: string;
  name: string;
  rrule: string;
  recurrencePreset: RecurrencePreset;
  expectedAmountMinor: number;
  accountId: string;
  accountName: string;
  categoryId: string;
  categoryName: string;
  nextDueOn: string;
  autopay: boolean;
  archivedAt: Date | null;
  currentReminderRung: string | null;
  currentReminderAcknowledgedAt: Date | null;
}

export class ReminderRuleError extends Error {
  constructor(message: string) { super(message); this.name = "ReminderRuleError"; }
}

interface RuleRow {
  id: string; user_id: string; name: string; rrule: string; expected_amount_minor: number | string;
  account_id: string; account_name: string; category_id: string; category_name: string;
  next_due_on: string | Date; autopay: boolean; archived_at: string | Date | null;
  current_reminder_rung: string | null; current_reminder_acknowledged_at: string | Date | null;
}

function isoDate(value: string | Date): string { return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10); }

function toRule(row: RuleRow): ReminderRule {
  return {
    id: row.id, userId: row.user_id, name: row.name, rrule: row.rrule,
    recurrencePreset: rruleToRecurrencePreset(row.rrule), expectedAmountMinor: Number(row.expected_amount_minor),
    accountId: row.account_id, accountName: row.account_name, categoryId: row.category_id, categoryName: row.category_name,
    nextDueOn: isoDate(row.next_due_on), autopay: row.autopay,
    archivedAt: row.archived_at === null ? null : new Date(row.archived_at), currentReminderRung: row.current_reminder_rung,
    currentReminderAcknowledgedAt: row.current_reminder_acknowledged_at === null ? null : new Date(row.current_reminder_acknowledged_at),
  };
}

function assertName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (!cleaned) throw new ReminderRuleError("a bill needs a name");
  if (cleaned.length > 120) throw new ReminderRuleError("bill name is too long (max 120 characters)");
  return cleaned;
}

function assertAmount(amountMinor: number): void {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new ReminderRuleError("expected amount must be a positive whole number of centavos");
}

function assertDate(date: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date)) throw new ReminderRuleError("due date must be YYYY-MM-DD");
  const [year, month, day] = date.split("-").map((part) => Number(part));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new ReminderRuleError("due date is not a real calendar day");
}

function assertDueDateMatchesRecurrence(rrule: string, nextDueOn: string): void {
  const preset = rruleToRecurrencePreset(rrule);
  const weekday = new Date(`${nextDueOn}T00:00:00Z`).getUTCDay();
  if (preset.startsWith("monthly:") && Number(preset.slice(8)) !== Number(nextDueOn.slice(8))) {
    throw new ReminderRuleError("monthly recurrence day must match the next due date");
  }
  if (!preset.startsWith("monthly:")) {
    const expected = ({ SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 })[preset.slice(preset.indexOf(":") + 1)]!;
    if (weekday !== expected) throw new ReminderRuleError("weekly recurrence weekday must match the next due date");
  }
}

async function assertAccounts(sql: Sql, userId: string, accountId: string, categoryId: string): Promise<void> {
  const { rows } = await sql.query<{ id: string; name: string; role: string; kind: string; archived_at: Date | string | null }>(
    "select id, name, role, kind, archived_at from accounts where user_id = $1 and id = any($2::uuid[])", [userId, [accountId, categoryId]],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const account = byId.get(accountId);
  const category = byId.get(categoryId);
  if (!account) throw new ReminderRuleError("that funding account does not exist");
  if (!category) throw new ReminderRuleError("that category does not exist");
  if (account.archived_at !== null) throw new ReminderRuleError(`"${account.name}" is archived`);
  if (category.archived_at !== null) throw new ReminderRuleError(`"${category.name}" is archived`);
  if (account.role !== "asset" && account.role !== "liability") throw new ReminderRuleError(`"${account.name}" is not a funding account`);
  if (category.role !== "expense" || category.kind !== "category") throw new ReminderRuleError(`"${category.name}" is not an expense category`);
}

const SELECT_RULE = `
  r.id, r.user_id, r.name, r.rrule, r.expected_amount_minor, r.account_id, funding.name as account_name,
  r.category_id, category.name as category_name, r.next_due_on, r.autopay, r.archived_at,
  reminder.rung as current_reminder_rung, reminder.acknowledged_at as current_reminder_acknowledged_at`;

export async function createReminderRule(sql: Sql, input: {
  userId: string; name: string; amountMinor: number; accountId: string; categoryId: string;
  recurrencePreset: string; nextDueOn: string; autopay?: boolean;
}): Promise<ReminderRule> {
  const name = assertName(input.name); assertAmount(input.amountMinor); assertDate(input.nextDueOn);
  let rrule: string;
  try { rrule = recurrencePresetToRrule(input.recurrencePreset); } catch (error) { throw new ReminderRuleError(error instanceof Error ? error.message : "invalid recurrence"); }
  assertDueDateMatchesRecurrence(rrule, input.nextDueOn);
  await assertAccounts(sql, input.userId, input.accountId, input.categoryId);
  const { rows } = await sql.query<RuleRow>(
    `insert into recurring_rules (user_id, name, rrule, expected_amount_minor, account_id, category_id, next_due_on, autopay)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id, user_id, name, rrule, expected_amount_minor, account_id, $9::text as account_name, category_id, $10::text as category_name, next_due_on, autopay, archived_at, null::text as current_reminder_rung, null::timestamptz as current_reminder_acknowledged_at`,
    [input.userId, name, rrule, input.amountMinor, input.accountId, input.categoryId, input.nextDueOn, input.autopay ?? false, "", ""],
  );
  const row = rows[0];
  row.account_name = (await sql.query<{ name: string }>("select name from accounts where id = $1", [input.accountId])).rows[0].name;
  row.category_name = (await sql.query<{ name: string }>("select name from accounts where id = $1", [input.categoryId])).rows[0].name;
  return toRule(row);
}

export async function listReminderRules(sql: Sql, userId: string, options: { includeArchived?: boolean } = {}): Promise<ReminderRule[]> {
  const { rows } = await sql.query<RuleRow>(
    `select ${SELECT_RULE} from recurring_rules r
      join accounts funding on funding.id = r.account_id join accounts category on category.id = r.category_id
      left join lateral (
        select rung, acknowledged_at from reminders
         where rule_id = r.id and cycle_due_on = r.next_due_on
         order by fire_at desc limit 1
      ) reminder on true
      where r.user_id = $1 and ($2::boolean or r.archived_at is null) order by r.next_due_on, r.name`,
    [userId, options.includeArchived ?? false],
  );
  return rows.map(toRule);
}

export async function updateReminderRule(sql: Sql, userId: string, id: string, changes: {
  name: string; amountMinor: number; accountId: string; categoryId: string; recurrencePreset: string; nextDueOn: string; autopay: boolean;
}): Promise<ReminderRule> {
  const { rows: existing } = await sql.query<{ id: string }>("select id from recurring_rules where id = $1 and user_id = $2", [id, userId]);
  if (!existing[0]) throw new ReminderRuleError("that bill does not exist");
  const name = assertName(changes.name); assertAmount(changes.amountMinor); assertDate(changes.nextDueOn);
  let rrule: string;
  try { rrule = recurrencePresetToRrule(changes.recurrencePreset); } catch (error) { throw new ReminderRuleError(error instanceof Error ? error.message : "invalid recurrence"); }
  assertDueDateMatchesRecurrence(rrule, changes.nextDueOn);
  await assertAccounts(sql, userId, changes.accountId, changes.categoryId);
  const { rows } = await sql.query<RuleRow>(
    `update recurring_rules set name = $3, rrule = $4, expected_amount_minor = $5, account_id = $6, category_id = $7, next_due_on = $8, autopay = $9
      where id = $1 and user_id = $2
      returning id, user_id, name, rrule, expected_amount_minor, account_id, $10::text as account_name, category_id, $11::text as category_name, next_due_on, autopay, archived_at, null::text as current_reminder_rung, null::timestamptz as current_reminder_acknowledged_at`,
    [id, userId, name, rrule, changes.amountMinor, changes.accountId, changes.categoryId, changes.nextDueOn, changes.autopay, "", ""],
  );
  const row = rows[0];
  row.account_name = (await sql.query<{ name: string }>("select name from accounts where id = $1", [changes.accountId])).rows[0].name;
  row.category_name = (await sql.query<{ name: string }>("select name from accounts where id = $1", [changes.categoryId])).rows[0].name;
  return toRule(row);
}

export async function archiveReminderRule(sql: Sql, userId: string, id: string): Promise<void> {
  const result = await sql.query<{ id: string }>("update recurring_rules set archived_at = now() where id = $1 and user_id = $2 and archived_at is null returning id", [id, userId]);
  if (result.rows[0]) return;
  const existing = await sql.query<{ id: string }>("select id from recurring_rules where id = $1 and user_id = $2", [id, userId]);
  if (!existing.rows[0]) throw new ReminderRuleError("that bill does not exist");
}

export async function markReminderRulePaid(sql: Sql, userId: string, id: string): Promise<void> {
  await sql.query("begin");
  try {
    const { rows } = await sql.query<{ rrule: string; next_due_on: string | Date }>(
      "select rrule, next_due_on from recurring_rules where id = $1 and user_id = $2 and archived_at is null for update", [id, userId],
    );
    if (!rows[0]) throw new ReminderRuleError("that active bill does not exist");
    const dueOn = isoDate(rows[0].next_due_on);
    await sql.query("update reminders set acknowledged_at = now() where rule_id = $1 and cycle_due_on = $2 and acknowledged_at is null", [id, dueOn]);
    await sql.query("update recurring_rules set next_due_on = $3 where id = $1 and user_id = $2", [id, userId, nextOccurrence(rows[0].rrule, dueOn)]);
    await sql.query("commit");
  } catch (error) { await sql.query("rollback"); throw error; }
}
