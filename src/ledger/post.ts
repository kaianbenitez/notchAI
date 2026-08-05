/**
 * The single write path into the ledger.
 *
 * Nothing else in the app may insert into `entries`. Every write goes through
 * postTransaction, which balances the entries and commits them atomically. The
 * database trigger is the backstop; this is the front door with the useful
 * error messages.
 */

import type { EntryDraft } from "./split.js";

/** Minimal pg-compatible client. Satisfied by `pg`, PGlite, and Supabase. */
export interface Sql {
  query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }>;
}

export type TxnSource =
  | "manual" | "snap" | "receipt" | "voice"
  | "email" | "csv" | "statement" | "unbilled" | "sms"
  | "ibkr" | "recurring";

export type TxnStatus = "confirmed" | "pending_review" | "stub" | "duplicate_merged";

export interface TransactionHeader {
  userId: string;
  occurredAt: string; // YYYY-MM-DD
  payee?: string | null;
  memo?: string | null;
  source?: TxnSource;
  status?: TxnStatus;
  confidence?: number | null;
  groupId?: string | null;
  sourceRef?: string | null;
  dedupeHash?: string | null;
  reducedKey?: string | null;
  seenUnbilledAt?: Date | null;
  postedAt?: Date | null;
  ingestEventId?: string | null;
}

/** An entry with optional foreign currency. Omit both FX fields for PHP. */
export interface EntryInput extends EntryDraft {
  currency?: string;
  /** Multiply by this to get PHP. Required when currency is not PHP. */
  fxRateToBase?: number;
}

interface ResolvedEntry extends EntryInput {
  currency: string;
  fxRateToBase: number;
  baseAmountMinor: number;
}

export class UnbalancedTransactionError extends Error {
  constructor(readonly residualMinor: number, readonly entries: ResolvedEntry[]) {
    super(
      `entries do not balance: they sum to ${residualMinor} centavos (must be 0). ` +
        `Entries: ${entries
          .map((e) => `${e.accountId}=${e.baseAmountMinor}`)
          .join(", ")}`,
    );
    this.name = "UnbalancedTransactionError";
  }
}

function resolve(entries: EntryInput[]): ResolvedEntry[] {
  return entries.map((e) => {
    const currency = e.currency ?? "PHP";
    const fxRateToBase = currency === "PHP" ? 1 : e.fxRateToBase ?? NaN;

    if (!Number.isFinite(fxRateToBase)) {
      throw new Error(`entry in ${currency} needs an fxRateToBase`);
    }
    if (!Number.isInteger(e.amountMinor)) {
      throw new Error(`amountMinor must be an integer, got ${e.amountMinor}`);
    }
    if (e.amountMinor === 0) {
      throw new Error("an entry of zero has no meaning; omit it");
    }

    return {
      ...e,
      currency,
      fxRateToBase,
      baseAmountMinor:
        currency === "PHP"
          ? e.amountMinor
          : Math.round(e.amountMinor * fxRateToBase),
    };
  });
}

/**
 * Write a balanced transaction. Throws before touching the database if the
 * entries do not sum to zero.
 *
 * On multi-currency transactions, rounding each leg independently can leave a
 * centavo or two of residual. That is the caller's to place — put it on the
 * expense leg or on an "FX rounding" account. Silently absorbing it here would
 * hide real conversion bugs.
 */
export async function postTransaction(
  sql: Sql,
  header: TransactionHeader,
  entries: EntryInput[],
): Promise<string> {
  if (entries.length < 2) {
    throw new Error(
      `a transaction needs at least two entries, got ${entries.length}`,
    );
  }

  const resolved = resolve(entries);
  const residual = resolved.reduce((s, e) => s + e.baseAmountMinor, 0);
  if (residual !== 0) throw new UnbalancedTransactionError(residual, resolved);

  await sql.query("begin");
  try {
    const { rows } = await sql.query<{ id: string }>(
      `insert into transactions
         (user_id, occurred_at, payee, memo, source, status, confidence,
          group_id, source_ref, dedupe_hash, reduced_key, seen_unbilled_at, posted_at,
          ingest_event_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       returning id`,
      [
        header.userId,
        header.occurredAt,
        header.payee ?? null,
        header.memo ?? null,
        header.source ?? "manual",
        header.status ?? "confirmed",
        header.confidence ?? null,
        header.groupId ?? null,
        header.sourceRef ?? null,
        header.dedupeHash ?? null,
        header.reducedKey ?? null,
        header.seenUnbilledAt ?? null,
        header.postedAt ?? null,
        header.ingestEventId ?? null,
      ],
    );
    const txnId = rows[0].id;

    for (const e of resolved) {
      await sql.query(
        `insert into entries
           (transaction_id, account_id, amount_minor, currency,
            base_amount_minor, fx_rate_to_base)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          txnId,
          e.accountId,
          e.amountMinor,
          e.currency,
          e.baseAmountMinor,
          e.fxRateToBase,
        ],
      );
    }

    await sql.query("commit"); // deferred trigger fires here
    return txnId;
  } catch (err) {
    await sql.query("rollback");
    throw err;
  }
}
