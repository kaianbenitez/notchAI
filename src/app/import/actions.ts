"use server";

import { revalidatePath } from "next/cache";

import { listAccounts } from "../../accounts/repo";
import { currentUserId } from "../../auth";
import { matchCategory } from "../../capture/ai-parse";
import { withDb } from "../../db/client";
import { commitMatchedStatement, commitNewStatement } from "../../import/commit";
import { assignMatches, classifyMatch, dedupeHash, type MatchableStatementRow, type MatchableTransaction } from "../../import/match";
import { extractPdfText } from "../../import/pdf-extract";
import { callGeminiForStatement, normalizeStatementRow, type StatementRow } from "../../import/statement-parse";
import type { CommitImportState, ExtractChargeRow, ExtractImportState, ImportCandidate } from "./action-state";

function stringField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map((part) => Number.parseInt(part, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function isoDate(value: string | Date): string {
  if (typeof value === "string") return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface CandidateRow {
  id: string;
  occurred_at: string | Date;
  payee: string | null;
  amount_minor: string | number;
  dedupe_hash: string | null;
  category_id: string | null;
  category_name: string | null;
}

interface Candidate extends ImportCandidate, MatchableTransaction {}

async function insertIngestEvent(userId: string, accountId: string, rawPayload: string): Promise<string> {
  return withDb(async (sql) => {
    const { rows: accounts } = await sql.query<{ id: string }>(
      `select id from accounts
        where id = $1 and user_id = $2 and role = 'liability' and kind = 'credit_card' and archived_at is null`,
      [accountId, userId],
    );
    if (!accounts[0]) throw new Error("Choose one of your active credit-card accounts.");
    const { rows } = await sql.query<{ id: string }>(
      `insert into ingest_events (user_id, kind, account_id, raw_payload)
       values ($1, 'statement', $2, $3)
       returning id`,
      [userId, accountId, rawPayload],
    );
    return rows[0].id;
  });
}

async function candidateTransactions(userId: string, accountId: string, earliest: string, latest: string): Promise<Candidate[]> {
  return withDb(async (sql) => {
    const { rows } = await sql.query<CandidateRow>(
      `select t.id, t.occurred_at, t.payee, abs(card_entry.base_amount_minor) as amount_minor,
              t.dedupe_hash, category_entry.category_id, category_entry.category_name
         from transactions t
         join entries card_entry on card_entry.transaction_id = t.id and card_entry.account_id = $1
         left join lateral (
           select e.account_id as category_id, a.name as category_name
             from entries e
             join accounts a on a.id = e.account_id
            where e.transaction_id = t.id and a.role = 'expense' and a.kind = 'category'
            limit 1
         ) category_entry on true
        where t.user_id = $2
          and t.ingest_event_id is null
          and t.occurred_at between $3::date and $4::date
          and card_entry.base_amount_minor < 0
        order by t.occurred_at, t.created_at`,
      [accountId, userId, shiftDate(earliest, -10), shiftDate(latest, 10)],
    );
    return rows.map((row) => ({
      id: row.id,
      occurredAt: isoDate(row.occurred_at),
      payee: row.payee ?? "",
      amountMinor: Math.abs(Number(row.amount_minor)),
      currency: "PHP",
      normalizedMerchant: row.payee ?? "",
      accountId,
      dedupeHash: row.dedupe_hash,
      categoryId: row.category_id,
      categoryName: row.category_name,
    }));
  });
}

export async function extractStatementAction(_previous: ExtractImportState, form: FormData): Promise<ExtractImportState> {
  try {
    const pdf = form.get("pdf");
    const accountId = stringField(form, "accountId");
    if (!(pdf instanceof File) || pdf.size === 0) return { error: "Choose a PDF statement first.", ingestEventId: null, accountId: null, charges: [], paymentsAndCredits: [], unmatchedCandidates: [] };
    if (!accountId) return { error: "Choose the credit-card account this statement belongs to.", ingestEventId: null, accountId: null, charges: [], paymentsAndCredits: [], unmatchedCandidates: [] };

    const text = await extractPdfText(Buffer.from(await pdf.arrayBuffer()), stringField(form, "password"));
    const userId = currentUserId();
    // Store the raw statement before the network parse so it remains recoverable on any later failure.
    const ingestEventId = await insertIngestEvent(userId, accountId, text);
    const parsed = (await callGeminiForStatement(text)).map(normalizeStatementRow).filter((row): row is StatementRow => row !== null);
    const paymentsAndCredits = parsed.filter((row) => row.kind === "payment_or_credit");
    const statementCharges = parsed.filter((row) => row.kind === "charge");
    const categories = await withDb((sql) => listAccounts(sql, userId, { roles: ["expense"], kinds: ["category"] }));
    const candidates = statementCharges.length === 0
      ? []
      : await candidateTransactions(
        userId,
        accountId,
        statementCharges.reduce((earliest, row) => row.occurredAt < earliest ? row.occurredAt : earliest, statementCharges[0].occurredAt),
        statementCharges.reduce((latest, row) => row.occurredAt > latest ? row.occurredAt : latest, statementCharges[0].occurredAt),
      );

    const matchableRows: MatchableStatementRow[] = statementCharges.map((statementRow) => ({
        normalizedMerchant: statementRow.payee,
        amountMinor: statementRow.amountMinor,
        currency: "PHP",
        occurredAt: statementRow.occurredAt,
        accountId,
        dedupeHash: dedupeHash(statementRow.payee, statementRow.amountMinor, "PHP", statementRow.occurredAt),
    }));
    const assignments = assignMatches(matchableRows, candidates);
    const candidateMatched = new Set(assignments
      .filter((assignment) => assignment.candidate && assignment.score >= 0.5)
      .map((assignment) => assignment.candidate!.id));
    const duplicateKeys = new Map<string, number>();
    for (const row of matchableRows) {
      duplicateKeys.set(row.dedupeHash!, (duplicateKeys.get(row.dedupeHash!) ?? 0) + 1);
    }
    const charges: ExtractChargeRow[] = statementCharges.map((statementRow, index) => {
      const best = assignments[index];
      const category = statementRow.confidence >= 0.7 ? matchCategory(statementRow.categoryGuess, categories) : null;
      return {
        id: `${index}-${statementRow.occurredAt}-${statementRow.amountMinor}`,
        statementRow,
        classification: classifyMatch(best.score),
        score: best.score,
        candidate: best.candidate,
        suggestedCategoryId: category?.id ?? "",
        duplicateInStatement: (duplicateKeys.get(matchableRows[index].dedupeHash!) ?? 0) > 1,
      };
    });
    return {
      error: null,
      ingestEventId,
      accountId,
      charges,
      paymentsAndCredits,
      unmatchedCandidates: candidates.filter((candidate) => !candidateMatched.has(candidate.id)),
    };
  } catch (error) {
    console.error("statement extraction failed", error);
    return { error: error instanceof Error ? error.message : "Could not extract that statement.", ingestEventId: null, accountId: null, charges: [], paymentsAndCredits: [], unmatchedCandidates: [] };
  }
}

type ImportDecision =
  | { kind: "matched"; oldTransactionId: string; statementRow: StatementRow; categoryId: string }
  | { kind: "new"; statementRow: StatementRow; categoryId: string }
  | { kind: "skip"; statementRow: StatementRow };

function parseDecisions(form: FormData): ImportDecision[] {
  const serialized = stringField(form, "decisions");
  const parsed: unknown = JSON.parse(serialized);
  if (!Array.isArray(parsed)) throw new Error("The import decisions were invalid.");
  return parsed as ImportDecision[];
}

async function assertCommitScope(sql: Parameters<typeof commitNewStatement>[0], userId: string, ingestEventId: string, accountId: string, categoryId: string): Promise<void> {
  const { rows } = await sql.query<{ valid: boolean }>(
    `select exists(select 1 from ingest_events where id = $1 and user_id = $2 and account_id = $3) as valid`,
    [ingestEventId, userId, accountId],
  );
  if (!rows[0]?.valid) throw new Error("That statement import no longer belongs to this account.");
  const { rows: categories } = await sql.query<{ valid: boolean }>(
    `select exists(select 1 from accounts where id = $1 and user_id = $2 and role = 'expense' and kind = 'category' and archived_at is null) as valid`,
    [categoryId, userId],
  );
  if (!categories[0]?.valid) throw new Error("Choose one of your active expense categories.");
}

export async function commitImportAction(_previous: CommitImportState, form: FormData): Promise<CommitImportState> {
  let result: CommitImportState;
  try {
    const ingestEventId = stringField(form, "ingestEventId");
    const accountId = stringField(form, "accountId");
    if (!ingestEventId || !accountId) return { error: "The statement import is missing its account details.", succeeded: [], failed: [] };
    const decisions = parseDecisions(form);
    const userId = currentUserId();
    result = await withDb(async (sql) => {
      const succeeded: string[] = [];
      const failed: { row: string; reason: string }[] = [];
      for (const decision of decisions) {
        const label = `${decision.statementRow.occurredAt} · ${decision.statementRow.payee}`;
        if (decision.kind === "skip") continue;
        try {
          if (!decision.categoryId) throw new Error("Choose an expense category before importing this new charge.");
          await assertCommitScope(sql, userId, ingestEventId, accountId, decision.categoryId);
          const input = {
            userId,
            ingestEventId,
            accountId,
            categoryId: decision.categoryId,
            statementRow: {
              occurredAt: decision.statementRow.occurredAt,
              payee: decision.statementRow.payee,
              amountMinor: decision.statementRow.amountMinor,
              currency: "PHP",
            },
          };
          if (decision.kind === "matched") {
            if (!decision.oldTransactionId) throw new Error("Choose the logged transaction to replace.");
            await commitMatchedStatement(sql, { ...input, oldTransactionId: decision.oldTransactionId });
          } else {
            await commitNewStatement(sql, input);
          }
          succeeded.push(label);
        } catch (error) {
          failed.push({ row: label, reason: error instanceof Error ? error.message : "Could not import this row." });
        }
      }
      return { error: null, succeeded, failed };
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not commit this statement import.", succeeded: [], failed: [] };
  }

  // Cache invalidation is strictly post-commit convenience. It must never
  // replace the real outcome of already-committed ledger writes with a false
  // failure response: a retry after that lie could duplicate statement rows.
  try {
    revalidatePath("/month");
    revalidatePath("/log");
  } catch (error) {
    console.error("statement import cache invalidation failed", error);
  }
  return result;
}
