import type { Sql } from "../ledger/post";
import { formatPeso } from "../money";
import { rungForDate, type ReminderRung } from "./ladder";
import { closeReminderRuleCycle } from "./repo";

interface CronRule { id: string; name: string; expected_amount_minor: number | string; next_due_on: string | Date; }

function isoDate(value: string | Date): string { return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10); }

function messageFor(rule: CronRule, dueOn: string, rung: ReminderRung): string {
  const amount = formatPeso(Number(rule.expected_amount_minor));
  if (rung === "t_minus_5") return `Bill reminder: ${rule.name} (${amount}) is due on ${dueOn}, in 5 days.`;
  if (rung === "t_minus_1") return `Bill reminder: ${rule.name} (${amount}) is due tomorrow (${dueOn}).`;
  if (rung === "due") return `Bill due today: ${rule.name} (${amount}) is due on ${dueOn}.`;
  return `Bill overdue: ${rule.name} (${amount}) was due on ${dueOn}.`;
}

interface ReconciliationRule {
  id: string; user_id: string; rrule: string; expected_amount_minor: number | string;
  tolerance_pct: number | string; account_id: string; next_due_on: string | Date;
  last_matched_txn_id: string | null;
}

/** Close active bill cycles with an already-posted matching expense. */
export async function reconcileDueRules(sql: Sql, today: string): Promise<number> {
  void today;
  const { rows: rules } = await sql.query<ReconciliationRule>(
    `select id, user_id, rrule, expected_amount_minor, tolerance_pct, account_id, next_due_on, last_matched_txn_id
       from recurring_rules where archived_at is null`,
  );
  let reconciled = 0;
  for (const rule of rules) {
    await sql.query("begin");
    try {
      const { rows: locked } = await sql.query<ReconciliationRule>(
        `select id, user_id, rrule, expected_amount_minor, tolerance_pct, account_id, next_due_on, last_matched_txn_id
           from recurring_rules where id = $1 and archived_at is null for update`,
        [rule.id],
      );
      const current = locked[0];
      if (!current) { await sql.query("commit"); continue; }
      const dueOn = isoDate(current.next_due_on);
      const { rows: matches } = await sql.query<{ id: string }>(
        `select t.id
           from entries e
           join transactions t on t.id = e.transaction_id
          where e.account_id = $1
            and t.user_id = $2
            and e.amount_minor < 0
            and abs(abs(e.amount_minor) - $3::bigint) <= $3::numeric * $4::numeric / 100
            and t.occurred_at between $5::date - 5 and $5::date + 2
            and t.id is distinct from $6::uuid
          order by t.occurred_at, t.id
          limit 1`,
        [current.account_id, current.user_id, current.expected_amount_minor, current.tolerance_pct, dueOn, current.last_matched_txn_id],
      );
      if (matches[0]) {
        await closeReminderRuleCycle(sql, { id: current.id, userId: current.user_id, rrule: current.rrule, dueOn, lastMatchedTxnId: matches[0].id });
        reconciled += 1;
      }
      await sql.query("commit");
    } catch (error) { await sql.query("rollback"); throw error; }
  }
  return reconciled;
}

/** Materialize and deliver today's idempotent ladder reminders. */
export async function runDailyReminders(
  sql: Sql,
  today: string,
  sendMessage: (text: string) => Promise<void>,
): Promise<number> {
  const { rows: rules } = await sql.query<CronRule>(
    "select id, name, expected_amount_minor, next_due_on from recurring_rules where archived_at is null",
  );
  let sent = 0;
  for (const rule of rules) {
    const dueOn = isoDate(rule.next_due_on);
    const rung = rungForDate(dueOn, today);
    if (!rung) continue;
    const { rows: inserted } = await sql.query<{ id: string }>(
      `insert into reminders (rule_id, cycle_due_on, rung, fire_at)
       values ($1, $2, $3, $4) on conflict (rule_id, fire_at) do nothing returning id`,
      [rule.id, dueOn, rung, today],
    );
    if (!inserted[0]) continue;
    await sendMessage(messageFor(rule, dueOn, rung));
    await sql.query("update reminders set sent_at = now() where id = $1", [inserted[0].id]);
    sent += 1;
  }
  return sent;
}
