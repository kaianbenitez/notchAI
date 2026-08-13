/**
 * Metadata-only edit for an already-logged manual transaction: date, payee,
 * memo, category, and funding account. Amount is not editable here — changing
 * it would mean rebalancing entries outside `postTransaction`, the ledger's
 * only write path (see `src/ledger/post.ts`). A future "correction" flow that
 * reposts the transaction can add amount edits without touching this one.
 */

import type { Sql } from "../ledger/post";
import { dedupeHash } from "../import/match";

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditError";
  }
}

export interface EditableTransaction {
  id: string;
  occurredAt: string;
  payee: string | null;
  memo: string | null;
  categoryId: string;
  accountId: string;
  amountMinor: number;
  direction: "out" | "in";
}

interface EntryRow {
  account_id: string;
  amount_minor: string | number;
  role: "asset" | "liability" | "expense" | "income" | "equity";
  kind: string;
}

function toIsoDate(value: string | Date): string {
  if (typeof value === "string") return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Loads a transaction for editing. Only simple two-leg manual-shaped captures are supported. */
export async function getEditableTransaction(
  sql: Sql,
  userId: string,
  transactionId: string,
): Promise<EditableTransaction> {
  const { rows: txnRows } = await sql.query<{
    id: string; occurred_at: string | Date; payee: string | null; memo: string | null;
  }>(
    `select id, occurred_at, payee, memo from transactions where id = $1 and user_id = $2`,
    [transactionId, userId],
  );
  const txn = txnRows[0];
  if (!txn) throw new EditError("that transaction does not exist");

  const { rows: entries } = await sql.query<EntryRow>(
    `select e.account_id, e.amount_minor, a.role, a.kind
       from entries e
       join accounts a on a.id = e.account_id
      where e.transaction_id = $1`,
    [transactionId],
  );
  if (entries.length !== 2) {
    throw new EditError("this transaction has more than two legs and can't be edited here yet");
  }

  const category = entries.find((e) => e.kind === "category" && (e.role === "expense" || e.role === "income"));
  const account = entries.find((e) => e.kind !== "category" && (e.role === "asset" || e.role === "liability"));
  if (!category || !account) {
    throw new EditError("this transaction isn't a simple manual capture and can't be edited here yet");
  }

  return {
    id: txn.id,
    occurredAt: toIsoDate(txn.occurred_at),
    payee: txn.payee,
    memo: txn.memo,
    categoryId: category.account_id,
    accountId: account.account_id,
    amountMinor: Math.abs(Number(account.amount_minor)),
    direction: category.role === "expense" ? "out" : "in",
  };
}

export interface EditInput {
  occurredAt: string;
  payee: string;
  categoryId: string;
  accountId: string;
  memo?: string;
}

interface AccountRow {
  id: string;
  role: "asset" | "liability" | "expense" | "income" | "equity";
  kind: string;
  archived_at: Date | string | null;
}

async function liveOwnedAccount(sql: Sql, userId: string, id: string, label: string): Promise<AccountRow> {
  const { rows } = await sql.query<AccountRow>(
    `select id, role, kind, archived_at from accounts where id = $1 and user_id = $2`,
    [id, userId],
  );
  const account = rows[0];
  if (!account) throw new EditError(`that ${label} does not exist`);
  if (account.archived_at !== null) throw new EditError(`that ${label} is archived`);
  return account;
}

function requiredText(value: string, label: string): string {
  const clean = value.trim();
  if (!clean) throw new EditError(`${label} is required`);
  return clean;
}

/** Updates date/payee/memo/category/account on an existing transaction. Amounts are untouched. */
export async function updateTransaction(
  sql: Sql,
  userId: string,
  transactionId: string,
  input: EditInput,
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredAt)) {
    throw new EditError("date must be YYYY-MM-DD");
  }

  const existing = await getEditableTransaction(sql, userId, transactionId);
  const payee = requiredText(input.payee, existing.direction === "out" ? "payee" : "payer/source");

  const [category, account] = await Promise.all([
    liveOwnedAccount(sql, userId, input.categoryId, "category"),
    liveOwnedAccount(sql, userId, input.accountId, "account"),
  ]);

  const expectedCategoryRole = existing.direction === "out" ? "expense" : "income";
  if (category.role !== expectedCategoryRole || category.kind !== "category") {
    throw new EditError(`pick an ${expectedCategoryRole} category`);
  }
  const allowedAccountRoles = existing.direction === "out" ? ["asset", "liability"] : ["asset"];
  if (!allowedAccountRoles.includes(account.role) || account.kind === "category") {
    throw new EditError(
      existing.direction === "out"
        ? "pick an asset or liability account to pay from"
        : "pick an asset account to pay into",
    );
  }

  const memo = input.memo?.trim() || null;
  const newDedupeHash = dedupeHash(payee, existing.amountMinor, "PHP", input.occurredAt);

  await sql.query("begin");
  try {
    await sql.query(
      `update transactions
          set occurred_at = $1, payee = $2, memo = $3, dedupe_hash = $4, updated_at = now()
        where id = $5 and user_id = $6`,
      [input.occurredAt, payee, memo, newDedupeHash, transactionId, userId],
    );
    if (input.categoryId !== existing.categoryId) {
      await sql.query(
        `update entries set account_id = $1 where transaction_id = $2 and account_id = $3`,
        [input.categoryId, transactionId, existing.categoryId],
      );
    }
    if (input.accountId !== existing.accountId) {
      await sql.query(
        `update entries set account_id = $1 where transaction_id = $2 and account_id = $3`,
        [input.accountId, transactionId, existing.accountId],
      );
    }
    await sql.query("commit");
  } catch (err) {
    await sql.query("rollback");
    throw err;
  }
}
