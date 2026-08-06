import type { Sql } from "../ledger/post";

/**
 * Send the once-daily "log today's spending" nudge, unless the user already
 * logged at least one transaction today. Returns whether it sent.
 */
export async function sendCaptureNudgeIfNeeded(
  sql: Sql,
  userId: string,
  today: string,
  sendMessage: (text: string) => Promise<void>,
): Promise<boolean> {
  const { rows } = await sql.query<{ logged: boolean }>(
    `select exists(
       select 1 from transactions
        where user_id = $1
          and (created_at at time zone 'Asia/Manila')::date = $2::date
     ) as logged`,
    [userId, today],
  );
  if (rows[0].logged) return false;
  await sendMessage("No spending logged today yet — got a minute to catch it up before it's tomorrow's problem?");
  return true;
}
