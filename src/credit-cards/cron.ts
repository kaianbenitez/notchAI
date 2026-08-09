import type { Sql } from "../ledger/post";
import { formatPeso } from "../money";
import { rungForDate } from "../reminders/ladder";

/** Deliver each active card statement's daily reminder rung exactly once. */
export async function runCreditCardStatementReminders(sql: Sql, today: string, sendMessage: (text: string) => Promise<void>): Promise<number> {
  const { rows } = await sql.query<{ id: string; name: string; statement_amount_minor: string | number; due_on: string | Date }>(
    `select s.id, a.name, s.statement_amount_minor, s.due_on
       from credit_card_statements s join accounts a on a.id = s.account_id
      where s.status = 'active'`,
  );
  let sent = 0;
  for (const statement of rows) {
    const dueOn = typeof statement.due_on === "string" ? statement.due_on.slice(0, 10) : statement.due_on.toISOString().slice(0, 10);
    const rung = rungForDate(dueOn, today);
    if (!rung) continue;
    const { rows: inserted } = await sql.query<{ id: string }>(
      `insert into credit_card_statement_reminders (statement_id, rung, fire_at)
       values ($1,$2,$3) on conflict (statement_id, fire_at) do nothing returning id`, [statement.id, rung, today],
    );
    if (!inserted[0]) continue;
    const amount = formatPeso(Number(statement.statement_amount_minor));
    const message = rung === "t_minus_5" ? `Credit card reminder: ${statement.name} statement balance ${amount} is due on ${dueOn}, in 5 days.`
      : rung === "t_minus_1" ? `Credit card reminder: ${statement.name} statement balance ${amount} is due tomorrow (${dueOn}).`
        : rung === "due" ? `Credit card due today: ${statement.name} statement balance ${amount}.`
          : `Credit card overdue: ${statement.name} statement balance ${amount} was due on ${dueOn}.`;
    await sendMessage(message);
    await sql.query("update credit_card_statement_reminders set sent_at = now() where id = $1", [inserted[0].id]);
    sent += 1;
  }
  return sent;
}
