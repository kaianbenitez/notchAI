import { postTransaction, type Sql } from "../ledger/post";
import { dedupeHash } from "./match";

export class ImportCommitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportCommitError";
  }
}

export interface StatementCommitRow {
  occurredAt: string;
  payee: string;
  memo?: string | null;
  amountMinor: number;
  currency: string;
}

export interface NewStatementDecision {
  userId: string;
  ingestEventId: string;
  accountId: string;
  categoryId: string;
  statementRow: StatementCommitRow;
}

export interface MatchedStatementDecision extends NewStatementDecision {
  oldTransactionId: string;
}

/** Delete exactly one owned transaction; cascaded entries need no separate cleanup. */
export async function deleteOwnedTransaction(sql: Sql, userId: string, transactionId: string): Promise<void> {
  const { rows } = await sql.query<{ id: string }>(
    "select id from transactions where id = $1 and user_id = $2",
    [transactionId, userId],
  );
  if (!rows[0]) throw new ImportCommitError("that transaction does not exist or does not belong to you");
  await sql.query("delete from transactions where id = $1 and user_id = $2", [transactionId, userId]);
}

function statementEntries(decision: NewStatementDecision) {
  const { amountMinor, currency } = decision.statementRow;
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new ImportCommitError("statement amountMinor must be a positive integer");
  }
  if (currency !== "PHP") {
    throw new ImportCommitError("foreign-currency statement rows need an explicit FX posting path");
  }
  return [
    { accountId: decision.accountId, amountMinor: -amountMinor, currency },
    { accountId: decision.categoryId, amountMinor, currency },
  ];
}

async function postStatement(sql: Sql, decision: NewStatementDecision): Promise<string> {
  const row = decision.statementRow;
  const id = await postTransaction(sql, {
    userId: decision.userId,
    occurredAt: row.occurredAt,
    payee: row.payee,
    memo: row.memo ?? null,
    source: "statement",
    status: "confirmed",
    dedupeHash: dedupeHash(row.payee, row.amountMinor, row.currency, row.occurredAt),
    ingestEventId: decision.ingestEventId,
  }, statementEntries(decision));
  return id;
}

function nestedLedgerSql(sql: Sql): Sql {
  return {
    async query<T = unknown>(text: string, params?: unknown[]) {
      if (text === "begin") return sql.query<T>("savepoint import_statement_post");
      if (text === "commit") return sql.query<T>("release savepoint import_statement_post");
      if (text === "rollback") {
        await sql.query("rollback to savepoint import_statement_post");
        return sql.query<T>("release savepoint import_statement_post");
      }
      return sql.query<T>(text, params);
    },
  };
}

export async function commitNewStatement(sql: Sql, decision: NewStatementDecision): Promise<string> {
  return postStatement(sql, decision);
}

export async function commitMatchedStatement(sql: Sql, decision: MatchedStatementDecision): Promise<string> {
  await sql.query("begin");
  try {
    await deleteOwnedTransaction(sql, decision.userId, decision.oldTransactionId);
    const id = await postStatement(nestedLedgerSql(sql), decision);
    await sql.query("commit");
    return id;
  } catch (error) {
    await sql.query("rollback");
    throw error;
  }
}
