import { createHash } from "node:crypto";

export interface MatchableStatementRow {
  normalizedMerchant: string;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  accountId: string;
  dedupeHash?: string | null;
}

export interface MatchableTransaction extends MatchableStatementRow {}

/**
 * Normalizes merchant text exactly once for statement dedupe: trim the ends,
 * lowercase, and collapse every run of internal whitespace to one space.
 * Manual captures intentionally have no dedupe hash today, so this is only for
 * statement rows and future matching-compatible capture sources.
 */
function normalizeMerchant(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function dedupeHash(
  normalizedMerchant: string,
  amountMinor: number,
  currency: string,
  occurredAt: string,
): string {
  return createHash("sha256")
    .update([normalizeMerchant(normalizedMerchant), amountMinor, currency, occurredAt].join("|"))
    .digest("hex");
}

export function reducedKey(amountMinor: number, occurredAt: string, accountId: string): string {
  return [amountMinor, occurredAt, accountId].join("|");
}

function daysApart(left: string, right: string): number {
  const toUtc = (date: string) => {
    const [year, month, day] = date.split("-").map((part) => Number.parseInt(part, 10));
    return Date.UTC(year, month - 1, day);
  };
  return Math.abs(toUtc(left) - toUtc(right)) / 86_400_000;
}

function similarity(left: string, right: string): number {
  const a = normalizeMerchant(left);
  const b = normalizeMerchant(right);
  if (a === b) return 1;
  if (!a || !b) return 0;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

export function matchScore(statementRow: MatchableStatementRow, candidateTransaction: MatchableTransaction): number {
  if (statementRow.dedupeHash && statementRow.dedupeHash === candidateTransaction.dedupeHash) return 1;

  let score = 0;
  if (candidateTransaction.amountMinor !== 0
    && Math.abs(statementRow.amountMinor - candidateTransaction.amountMinor) / Math.abs(candidateTransaction.amountMinor) <= 0.05) score += 0.5;
  if (daysApart(statementRow.occurredAt, candidateTransaction.occurredAt) <= 7) score += 0.2;
  if (similarity(statementRow.normalizedMerchant, candidateTransaction.normalizedMerchant) >= 0.8) score += 0.2;
  if (statementRow.accountId === candidateTransaction.accountId) score += 0.1;
  return score;
}

export function classifyMatch(score: number): "auto" | "suggested" | "none" {
  if (score >= 0.8) return "auto";
  if (score >= 0.5) return "suggested";
  return "none";
}
