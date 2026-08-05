import type { Sql } from "../ledger/post";

/** Send at most one evening nudge for a day that has no logged transactions. */
export async function runDailyCaptureNudge(sql: Sql, today: string, sendMessage: (text: string) => Promise<void>): Promise<boolean> {
  const { rows: transactions } = await sql.query<{ exists: boolean }>("select exists(select 1 from transactions where occurred_at = $1::date) as exists", [today]);
  if (transactions[0]?.exists) return false;
  const { rows } = await sql.query<{ nudge_date: string }>("insert into capture_nudges (nudge_date) values ($1::date) on conflict do nothing returning nudge_date", [today]);
  if (!rows[0]) return false;
  await sendMessage("Quick check-in: no spending is logged for today yet. If you spent anything, add it to Notch while it’s fresh.");
  await sql.query("update capture_nudges set sent_at = now() where nudge_date = $1::date", [today]);
  return true;
}
