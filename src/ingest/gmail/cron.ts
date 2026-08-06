import type { Sql } from "../../ledger/post";
import { listGmailMessages } from "./client";
import { ingestGmailMessage } from "./repo";

export async function runGmailIngest(sql: Sql, userId: string): Promise<Record<string, number>> {
  const cursor = await sql.query<{ history_id: string | null }>("select history_id from gmail_sync_cursors where user_id = $1", [userId]);
  const result = await listGmailMessages(cursor.rows[0]?.history_id);
  const counts: Record<string, number> = { posted: 0, pending_review: 0, unrecognized: 0, duplicate: 0 };
  for (const message of result.messages) counts[await ingestGmailMessage(sql, userId, message)] += 1;
  await sql.query(`insert into gmail_sync_cursors (user_id, history_id, last_successful_at) values ($1,$2,now()) on conflict (user_id) do update set history_id=excluded.history_id,last_successful_at=excluded.last_successful_at`, [userId, result.historyId]);
  return counts;
}
