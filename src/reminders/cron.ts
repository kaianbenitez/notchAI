import type { Sql } from "../ledger/post";
import { formatPeso } from "../money";
import { rungForDate, type ReminderRung } from "./ladder";

interface CronRule { id: string; name: string; expected_amount_minor: number | string; next_due_on: string | Date; }

function isoDate(value: string | Date): string { return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10); }

function messageFor(rule: CronRule, dueOn: string, rung: ReminderRung): string {
  const amount = formatPeso(Number(rule.expected_amount_minor));
  if (rung === "t_minus_5") return `Bill reminder: ${rule.name} (${amount}) is due on ${dueOn}, in 5 days.`;
  if (rung === "t_minus_1") return `Bill reminder: ${rule.name} (${amount}) is due tomorrow (${dueOn}).`;
  if (rung === "due") return `Bill due today: ${rule.name} (${amount}) is due on ${dueOn}.`;
  return `Bill overdue: ${rule.name} (${amount}) was due on ${dueOn}.`;
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
