import type { StatementRow } from "../../import/statement-parse";

export interface ImportCategory {
  id: string;
  name: string;
}

export interface ImportCandidate {
  id: string;
  occurredAt: string;
  payee: string;
  amountMinor: number;
  categoryId: string | null;
  categoryName: string | null;
}

export interface ExtractChargeRow {
  id: string;
  statementRow: StatementRow;
  classification: "auto" | "suggested" | "none";
  score: number;
  candidate: ImportCandidate | null;
  suggestedCategoryId: string;
  duplicateInStatement: boolean;
}

export interface ExtractImportState {
  error: string | null;
  ingestEventId: string | null;
  accountId: string | null;
  charges: ExtractChargeRow[];
  paymentsAndCredits: StatementRow[];
  unmatchedCandidates: ImportCandidate[];
}

export interface CommitImportState {
  error: string | null;
  succeeded: string[];
  failed: { row: string; reason: string }[];
}

export const EMPTY_EXTRACT_IMPORT_STATE: ExtractImportState = {
  error: null, ingestEventId: null, accountId: null, charges: [], paymentsAndCredits: [], unmatchedCandidates: [],
};

export const EMPTY_COMMIT_IMPORT_STATE: CommitImportState = { error: null, succeeded: [], failed: [] };
