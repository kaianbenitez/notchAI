import type { Sql } from "../../ledger/post";
import { postTransaction } from "../../ledger/post";
import { dedupeHash } from "../../import/match";
import { dispatchGmail, normalizeDescriptor, type GmailMessage, type ParsedGmailTransaction } from "./parsers";

type ItemRow = { id: string; user_id: string; gmail_message_id: string; ingest_event_id: string; account_descriptor: string | null; payee_descriptor: string | null; occurred_at: string | Date | null; amount_minor: string | number | null; direction: "out" | "in" | null; account_id: string | null; category_id: string | null; status: string; transaction_id: string | null; raw_payload: string };
export type ReviewItem = { id: string; gmailMessageId: string; ingestEventId: string; accountDescriptor: string | null; payeeDescriptor: string | null; occurredAt: string | null; amountMinor: number | null; direction: "out" | "in" | null; accountId: string | null; categoryId: string | null; status: string; rawPayload: string };

function date(value: string | Date | null): string | null { return value === null ? null : typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10); }
function item(row: ItemRow): ReviewItem { return { id: row.id, gmailMessageId: row.gmail_message_id, ingestEventId: row.ingest_event_id, accountDescriptor: row.account_descriptor, payeeDescriptor: row.payee_descriptor, occurredAt: date(row.occurred_at), amountMinor: row.amount_minor === null ? null : Number(row.amount_minor), direction: row.direction, accountId: row.account_id, categoryId: row.category_id, status: row.status, rawPayload: row.raw_payload }; }

async function aliases(sql: Sql, userId: string, parsed: ParsedGmailTransaction) {
  const [account, category] = await Promise.all([
    sql.query<{ account_id: string }>("select account_id from gmail_account_aliases where user_id = $1 and descriptor = $2", [userId, normalizeDescriptor(parsed.accountDescriptor)]),
    sql.query<{ category_id: string }>("select category_id from gmail_payee_aliases where user_id = $1 and descriptor = $2", [userId, normalizeDescriptor(parsed.payee)]),
  ]);
  return { accountId: account.rows[0]?.account_id ?? null, categoryId: category.rows[0]?.category_id ?? null };
}

async function postResolved(sql: Sql, values: { userId: string; ingestEventId: string; parsed: ParsedGmailTransaction; accountId: string; categoryId: string }): Promise<string> {
  const { parsed } = values;
  const hash = dedupeHash(parsed.payee, parsed.amountMinor, "PHP", parsed.occurredAt);
  const existing = await sql.query<{ id: string }>(`select id from transactions where user_id = $1 and (source_ref = $2 or dedupe_hash = $3) and status <> 'duplicate_merged' limit 1`, [values.userId, parsed.sourceRef, hash]);
  if (existing.rows[0]) return existing.rows[0].id;
  return postTransaction(sql, { userId: values.userId, occurredAt: parsed.occurredAt, payee: parsed.payee, memo: parsed.memo, source: "email", status: "confirmed", sourceRef: parsed.sourceRef, dedupeHash: hash, ingestEventId: values.ingestEventId }, parsed.direction === "out"
    ? [{ accountId: values.accountId, amountMinor: -parsed.amountMinor }, { accountId: values.categoryId, amountMinor: parsed.amountMinor }]
    : [{ accountId: values.accountId, amountMinor: parsed.amountMinor }, { accountId: values.categoryId, amountMinor: -parsed.amountMinor }]);
}

/** Store raw source material first. A replayed Gmail id is a no-op. */
export async function ingestGmailMessage(sql: Sql, userId: string, message: GmailMessage): Promise<"posted" | "pending_review" | "unrecognized" | "duplicate"> {
  const known = /onlinebanking@bpi\.com\.ph|alerts@maribank\.com\.ph|bpiinstapay@bpi\.com\.ph/i.test(message.from);
  if (!known) throw new Error("refusing a message outside the allowlisted senders");
  const already = await sql.query("select id from gmail_ingest_items where user_id = $1 and gmail_message_id = $2", [userId, message.id]);
  if (already.rows[0]) return "duplicate";
  const raw = JSON.stringify(message);
  const parsed = dispatchGmail(message);
  const event = await sql.query<{ id: string }>(`insert into ingest_events (user_id, kind, raw_payload) values ($1, 'email', $2) returning id`, [userId, raw]);
  if (!parsed) {
    await sql.query(`insert into gmail_ingest_items (user_id, gmail_message_id, ingest_event_id, status) values ($1, $2, $3, 'unrecognized')`, [userId, message.id, event.rows[0].id]);
    return "unrecognized";
  }
  const resolved = await aliases(sql, userId, parsed);
  const inserted = await sql.query<{ id: string }>(`insert into gmail_ingest_items (user_id, gmail_message_id, ingest_event_id, account_descriptor, payee_descriptor, occurred_at, amount_minor, direction, account_id, category_id, status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending_review') returning id`, [userId, message.id, event.rows[0].id, parsed.accountDescriptor, parsed.payee, parsed.occurredAt, parsed.amountMinor, parsed.direction, resolved.accountId, resolved.categoryId]);
  if (!resolved.accountId || !resolved.categoryId) return "pending_review";
  const transactionId = await postResolved(sql, { userId, ingestEventId: event.rows[0].id, parsed, accountId: resolved.accountId, categoryId: resolved.categoryId });
  await sql.query("update gmail_ingest_items set status = 'confirmed', transaction_id = $2, resolved_at = now() where id = $1", [inserted.rows[0].id, transactionId]);
  return "posted";
}

export async function listGmailReviewItems(sql: Sql, userId: string): Promise<ReviewItem[]> {
  const { rows } = await sql.query<ItemRow>(`select g.*, e.raw_payload from gmail_ingest_items g join ingest_events e on e.id = g.ingest_event_id where g.user_id = $1 and g.status = 'pending_review' order by g.created_at desc`, [userId]);
  return rows.map(item);
}

async function assertResolution(sql: Sql, userId: string, accountId: string, categoryId: string, direction: "out" | "in") {
  const { rows } = await sql.query<{ id: string; role: string; kind: string }>("select id, role, kind from accounts where user_id = $1 and id = any($2::uuid[]) and archived_at is null", [userId, [accountId, categoryId]]);
  const account = rows.find((row) => row.id === accountId); const category = rows.find((row) => row.id === categoryId);
  if (!account || !category || account.kind === "category" || !["asset", "liability"].includes(account.role) || category.kind !== "category" || category.role !== (direction === "out" ? "expense" : "income")) throw new Error("choose a live funding account and a matching category");
}

export async function resolveGmailReviewItem(sql: Sql, userId: string, id: string, accountId: string, categoryId: string): Promise<string> {
  const { rows } = await sql.query<ItemRow>(`select g.*, e.raw_payload from gmail_ingest_items g join ingest_events e on e.id = g.ingest_event_id where g.id = $1 and g.user_id = $2 and g.status = 'pending_review' for update`, [id, userId]);
  const current = rows[0];
  if (!current || !current.occurred_at || !current.amount_minor || !current.direction || !current.account_descriptor || !current.payee_descriptor) throw new Error("that email cannot be confirmed");
  await assertResolution(sql, userId, accountId, categoryId, current.direction);
  const message = JSON.parse(current.raw_payload) as GmailMessage; const parsed = dispatchGmail(message);
  if (!parsed) throw new Error("that email is not a recognized transaction template");
  const transactionId = await postResolved(sql, { userId, ingestEventId: current.ingest_event_id, parsed, accountId, categoryId });
  await sql.query(`insert into gmail_account_aliases (user_id, descriptor, account_id) values ($1,$2,$3) on conflict (user_id, descriptor) do update set account_id = excluded.account_id`, [userId, normalizeDescriptor(parsed.accountDescriptor), accountId]);
  await sql.query(`insert into gmail_payee_aliases (user_id, descriptor, category_id) values ($1,$2,$3) on conflict (user_id, descriptor) do update set category_id = excluded.category_id`, [userId, normalizeDescriptor(parsed.payee), categoryId]);
  await sql.query("update gmail_ingest_items set account_id=$2, category_id=$3, status='confirmed', transaction_id=$4, resolved_at=now() where id=$1", [id, accountId, categoryId, transactionId]);
  return transactionId;
}

export async function dismissGmailReviewItem(sql: Sql, userId: string, id: string): Promise<void> { await sql.query("update gmail_ingest_items set status = 'dismissed', resolved_at = now() where id = $1 and user_id = $2 and status = 'pending_review'", [id, userId]); }
