/** Manual, single-category transaction capture built on the ledger front door. */

import { parseAmountToMinor } from "../money";
import { postTransaction, type Sql } from "../ledger/post";

export type CaptureDirection = "out" | "in";

export class CaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureError";
  }
}

export interface CaptureInput {
  userId: string;
  direction: CaptureDirection;
  occurredAt: string;
  payee: string;
  amount: string;
  categoryId: string;
  accountId: string;
  memo?: string;
  /** Client-minted offline queue id. Not importer deduplication. */
  clientId?: string;
}

interface AccountRow {
  id: string;
  name: string;
  role: "asset" | "liability" | "expense" | "income" | "equity";
  kind: string;
  archived_at: Date | string | null;
}

async function liveOwnedAccount(sql: Sql, userId: string, id: string, label: string): Promise<AccountRow> {
  const { rows } = await sql.query<AccountRow>(
    `select id, name, role, kind, archived_at
       from accounts
      where id = $1 and user_id = $2`,
    [id, userId],
  );
  const account = rows[0];
  if (!account) throw new CaptureError(`that ${label} does not exist`);
  if (account.archived_at !== null) throw new CaptureError(`that ${label} is archived`);
  return account;
}

function requiredText(value: string, label: string): string {
  const clean = value.trim();
  if (!clean) throw new CaptureError(`${label} is required`);
  return clean;
}

/**
 * Validate and post one manual expense or income. This intentionally leaves
 * dedupe fields absent: the importer owns that format and its matching rules.
 */
export async function captureTransaction(sql: Sql, input: CaptureInput): Promise<string> {
  if (input.direction !== "out" && input.direction !== "in") {
    throw new CaptureError("pick money in or money out");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredAt)) {
    throw new CaptureError("date must be YYYY-MM-DD");
  }

  const sourceRef = input.clientId?.trim() || null;
  if (sourceRef) {
    const { rows } = await sql.query<{ id: string }>(
      `select id from transactions where user_id = $1 and source_ref = $2`,
      [input.userId, sourceRef],
    );
    if (rows[0]) return rows[0].id;
  }

  const payee = requiredText(input.payee, input.direction === "out" ? "payee" : "payer/source");
  const amountMinor = parseAmountToMinor(input.amount);
  if (amountMinor <= 0) throw new CaptureError("amount must be greater than zero");

  const [account, category] = await Promise.all([
    liveOwnedAccount(sql, input.userId, input.accountId, "account"),
    liveOwnedAccount(sql, input.userId, input.categoryId, "category"),
  ]);

  const expectedCategoryRole = input.direction === "out" ? "expense" : "income";
  if (category.role !== expectedCategoryRole || category.kind !== "category") {
    throw new CaptureError(`pick an ${expectedCategoryRole} category`);
  }

  const allowedAccountRoles = input.direction === "out" ? ["asset", "liability"] : ["asset"];
  if (!allowedAccountRoles.includes(account.role) || account.kind === "category") {
    throw new CaptureError(
      input.direction === "out"
        ? "pick an asset or liability account to pay from"
        : "pick an asset account to pay into",
    );
  }

  try {
    return await postTransaction(
      sql,
      {
        userId: input.userId,
        occurredAt: input.occurredAt,
        payee,
        memo: input.memo?.trim() || null,
        source: "manual",
        status: "confirmed",
        sourceRef,
      },
      input.direction === "out"
        ? [
            { accountId: account.id, amountMinor: -amountMinor },
            { accountId: category.id, amountMinor },
          ]
        : [
            { accountId: account.id, amountMinor },
            { accountId: category.id, amountMinor: -amountMinor },
          ],
    );
  } catch (error) {
    // A previous request may have committed after this request's initial
    // lookup. The partial unique index is the race-safe backstop; a retry
    // reads that transaction back rather than reporting a false failure.
    if (sourceRef && (error as { code?: string }).code === "23505") {
      const { rows } = await sql.query<{ id: string }>(
        `select id from transactions where user_id = $1 and source_ref = $2`,
        [input.userId, sourceRef],
      );
      if (rows[0]) return rows[0].id;
    }
    throw error;
  }
}

/**
 * A DATE column carries no time and no timezone. node-postgres hands it back as
 * a Date at *local* midnight, so read the local components straight back out.
 * Formatting it through a fixed timezone shifts the day backwards for anyone
 * running east of that zone — the row would display as the day before.
 */
function toIsoDate(value: string | Date): string {
  if (typeof value === "string") return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export interface RecentTransaction {
  id: string;
  occurredAt: string;
  payee: string | null;
  category: string;
  account: string;
  amountMinor: number;
}

/** The compact feedback loop shown immediately below manual capture. */
export async function listRecentTransactions(
  sql: Sql,
  userId: string,
  limit = 20,
): Promise<RecentTransaction[]> {
  const { rows } = await sql.query<{
    id: string; occurred_at: string | Date; payee: string | null; category: string;
    account: string; amount_minor: string | number;
  }>(
    `select t.id, t.occurred_at, t.payee, category.name as category,
            account.name as account, category_entry.base_amount_minor as amount_minor
       from transactions t
       join entries category_entry on category_entry.transaction_id = t.id
       join accounts category on category.id = category_entry.account_id
       join entries account_entry on account_entry.transaction_id = t.id
       join accounts account on account.id = account_entry.account_id
      where t.user_id = $1
        and category.role in ('expense', 'income')
        and category.kind = 'category'
        and account.role in ('asset', 'liability')
        and account.kind <> 'category'
      order by t.occurred_at desc, t.created_at desc
      limit $2`,
    [userId, limit],
  );
  return rows.map((row) => ({
    id: row.id,
    occurredAt: toIsoDate(row.occurred_at),
    payee: row.payee,
    category: row.category,
    account: row.account,
    // The feed is a human receipt, not a ledger export: both directions show
    // the magnitude while the category/account convey what moved.
    amountMinor: Math.abs(Number(row.amount_minor)),
  }));
}
