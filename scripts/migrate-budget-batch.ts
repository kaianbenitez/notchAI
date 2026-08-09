import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { currentUserId } from "../src/auth";
import { withDb } from "../src/db/client";
import { dedupeHash } from "../src/import/match";
import { parseAmountToMinor } from "../src/money";
import {
  ACCOUNT_MAP,
  CATEGORY_MAP,
  LEDGER_HEADERS,
  TRANSFER_HEADERS,
  accountDefinition,
  categoryDefinition,
  expectedRole,
  exactKey,
  parseRows,
  type LedgerRow,
  type TransferRow,
} from "./migrate-budget";

const FX_RATE = 58;

function resetStatements(): string[] {
  return [
    `delete from reminders where rule_id in (select id from recurring_rules where user_id = $1)`,
    `delete from gmail_ingest_items where user_id = $1`,
    `delete from gmail_payee_aliases where user_id = $1`,
    `delete from gmail_account_aliases where user_id = $1`,
    `delete from gmail_sync_cursors where user_id = $1`,
    `delete from dismissed_bill_suggestions where user_id = $1`,
    `delete from capture_nudges where $1 = $1`,
    `delete from recurring_rules where user_id = $1`,
    `delete from budgets where user_id = $1`,
    `delete from splits where transaction_id in (select id from transactions where user_id = $1)`,
    `delete from entries where account_id in (select id from accounts where user_id = $1)`,
    `delete from transactions where user_id = $1`,
    `delete from ingest_events where user_id = $1`,
    `delete from group_members where group_id in (select id from groups where user_id = $1) or person_id in (select id from people where user_id = $1)`,
    `delete from groups where user_id = $1`,
    `delete from people where user_id = $1`,
    `delete from accounts where user_id = $1`,
  ];
}

function normalizedLedger(rows: LedgerRow[]) {
  const seen = new Set<string>();
  return rows.flatMap((row, index) => {
    const key = exactKey(row);
    if (seen.has(key)) return [];
    seen.add(key);
    const account = accountDefinition(row.Account);
    const category = categoryDefinition(row);
    const role = expectedRole(row.Transaction.trim());
    const amount = parseAmountToMinor(row.Price);
    const foreign = row.Currency.trim().toUpperCase() !== "PHP";
    const amountBase = Math.round(amount * (foreign ? FX_RATE : 1));
    const accountCurrency = foreign && account.currency === "USD" ? "USD" : "PHP";
    const accountAmount = foreign && account.currency === "USD" ? amount : amountBase;
    const refund = role === "refund";
    const income = role === "income";
    const accountEntryAmount = accountCurrency === "USD"
      ? (refund ? amount : income ? amount : -amount)
      : (refund || income ? amountBase : -amountBase);
    return [{
      sourceRef: `budget-migration:ledger:${index}`,
      accountName: account.name,
      categoryName: category.name,
      categoryRole: category.role,
      date: row.Date,
      payee: row.Note.trim() || row.Subcategory.trim() || category.name,
      memo: row.Tag.trim() ? `Tag: ${row.Tag.trim()}` : null,
      accountAmount: accountEntryAmount,
      accountCurrency,
      accountBase: accountEntryAmount * (accountCurrency === "USD" ? FX_RATE : 1),
      accountFx: accountCurrency === "USD" ? FX_RATE : 1,
      categoryAmount: refund ? -amountBase : income ? -amountBase : amountBase,
      rawPayload: JSON.stringify(row),
      dedupe: dedupeHash(row.Note.trim() || row.Subcategory.trim() || category.name, Math.abs(accountEntryAmount), accountCurrency, row.Date),
    }];
  });
}

function normalizedTransfers(rows: TransferRow[]) {
  const seen = new Set<string>();
  return rows.flatMap((row, index) => {
    const key = exactKey(row);
    if (seen.has(key)) return [];
    seen.add(key);
    const from = accountDefinition(row.From);
    const to = accountDefinition(row.To);
    const amount = parseAmountToMinor(row.Price);
    const currency = row.Currency.trim().toUpperCase();
    const baseAmount = Math.round(amount * (currency === "USD" ? FX_RATE : 1));
    const fromCurrency = currency !== "PHP" && from.currency === currency ? currency : "PHP";
    const toCurrency = currency !== "PHP" && to.currency === currency ? currency : "PHP";
    return [{
      sourceRef: `budget-migration:transfer:${index}`,
      fromName: from.name,
      toName: to.name,
      date: row.Date,
      payee: `${from.name} → ${to.name}`,
      memo: row.Note.trim() || null,
      fromAmount: fromCurrency === currency ? -amount : -baseAmount,
      fromCurrency,
      fromBase: -baseAmount,
      fromFx: fromCurrency === "USD" ? FX_RATE : 1,
      toAmount: toCurrency === currency ? amount : baseAmount,
      toCurrency,
      toBase: baseAmount,
      toFx: toCurrency === "USD" ? FX_RATE : 1,
      rawPayload: JSON.stringify(row),
      dedupe: dedupeHash(`${from.name} → ${to.name}`, amount, currency, row.Date),
    }];
  });
}

async function main(): Promise<void> {
  process.loadEnvFile?.();
  const args = process.argv.slice(2);
  const append = args[0] === "--append";
  const ranged = append || args[0] === "--reset";
  const offset = ranged ? Number(args[1]) : 0;
  const end = ranged ? Number(args[2]) : 100;
  const paths = ranged ? args.slice(3) : args;
  if (paths.length !== 2 || paths.some((path) => !isAbsolute(path)) || !Number.isInteger(offset) || !Number.isInteger(end) || offset < 0 || end <= offset) throw new Error("Usage: npx tsx scripts/migrate-budget-batch.ts [--append <start> <end>] <ledger.csv> <transfers.csv>");
  const ledgerRows = parseRows(await readFile(resolve(paths[0]), "utf8"), LEDGER_HEADERS);
  const transferRows = parseRows(await readFile(resolve(paths[1]), "utf8"), TRANSFER_HEADERS);
  const allLedger = normalizedLedger(ledgerRows);
  const allTransfers = normalizedTransfers(transferRows);
  allLedger.forEach((row, index) => { row.sourceRef = `budget-migration:ledger:${index}`; });
  allTransfers.forEach((row, index) => { row.sourceRef = `budget-migration:transfer:${index}`; });
  const ledger = allLedger.slice(offset, end);
  const transfers = allTransfers.slice(offset, end);
  const userId = currentUserId();
  const accountNames = new Set([...ledger.map((row) => row.accountName), ...transfers.flatMap((row) => [row.fromName, row.toName])]);
  const accounts = [...accountNames].map((name) => {
    const definition = Object.values(ACCOUNT_MAP).find((candidate) => candidate.name === name);
    if (!definition) throw new Error(`Missing account definition for ${name}`);
    return { name, role: definition.role, kind: definition.kind, currency: definition.currency };
  });
  const categories = [...new Map(ledger.map((row) => [`${row.categoryRole}:${row.categoryName}`, { name: row.categoryName, role: row.categoryRole }])).values()];
  const ledgerPayload = ledger.map((row) => ({ source_ref: row.sourceRef, account_name: row.accountName, category_name: row.categoryName, category_role: row.categoryRole, date: row.date, payee: row.payee, memo: row.memo, account_amount: row.accountAmount, account_currency: row.accountCurrency, account_base: row.accountBase, account_fx: row.accountFx, category_amount: row.categoryAmount, category_base: row.categoryAmount, dedupe: row.dedupe, raw_payload: row.rawPayload }));
  const transferPayload = transfers.map((row) => ({ source_ref: row.sourceRef, from_name: row.fromName, to_name: row.toName, date: row.date, payee: row.payee, memo: row.memo, from_amount: row.fromAmount, from_currency: row.fromCurrency, from_base: row.fromBase, from_fx: row.fromFx, to_amount: row.toAmount, to_currency: row.toCurrency, to_base: row.toBase, to_fx: row.toFx, dedupe: row.dedupe, raw_payload: row.rawPayload }));
  const phpMismatch = [...ledger.filter((row) => row.accountCurrency === "PHP" && (Math.abs(row.accountAmount) !== Math.abs(row.accountBase) || row.accountFx !== 1)), ...transfers.flatMap((row) => [row.fromCurrency === "PHP" && (row.fromAmount !== row.fromBase || row.fromFx !== 1) ? row : null, row.toCurrency === "PHP" && (row.toAmount !== row.toBase || row.toFx !== 1) ? row : null])].filter(Boolean);
  if (phpMismatch.length > 0) throw new Error(`PHP conversion mismatch in ${phpMismatch.length} migration rows`);

  await withDb(async (sql) => {
    await sql.query("begin");
    try {
      if (!append) for (const statement of resetStatements()) await sql.query(statement, [userId]);
      await sql.query(`insert into accounts (user_id, name, role, kind, currency) select $1, x.name, x.role::account_role, x.kind::account_kind, x.currency from jsonb_to_recordset($2::jsonb) as x(name text, role text, kind text, currency text) where not exists (select 1 from accounts a where a.user_id=$1 and a.name=x.name and a.role=x.role::account_role)`, [userId, JSON.stringify(accounts)]);
      await sql.query(`insert into accounts (user_id, name, role, kind, currency) select $1, x.name, x.role::account_role, 'category'::account_kind, 'PHP' from jsonb_to_recordset($2::jsonb) as x(name text, role text) where not exists (select 1 from accounts a where a.user_id=$1 and a.name=x.name and a.role=x.role::account_role)`, [userId, JSON.stringify(categories)]);
      await sql.query(`create temporary table budget_migration_rows (kind text, source_ref text, account_name text, category_name text, category_role text, from_name text, to_name text, occurred_at date, payee text, memo text, amount_a bigint, currency_a text, base_a bigint, fx_a numeric, amount_b bigint, currency_b text, base_b bigint, fx_b numeric, dedupe_hash text, raw_payload text) on commit drop`);
      await sql.query(`insert into budget_migration_rows (kind, source_ref, account_name, category_name, category_role, occurred_at, payee, memo, amount_a, currency_a, base_a, fx_a, amount_b, base_b, dedupe_hash, raw_payload) select 'ledger', source_ref, account_name, category_name, category_role, date, payee, memo, account_amount, account_currency, account_base, account_fx, category_amount, category_base, dedupe, raw_payload from jsonb_to_recordset($1::jsonb) as x(source_ref text, account_name text, category_name text, category_role text, date date, payee text, memo text, account_amount bigint, account_currency text, account_base bigint, account_fx numeric, category_amount bigint, category_base bigint, dedupe text, raw_payload text)`, [JSON.stringify(ledgerPayload)]);
      await sql.query(`insert into budget_migration_rows (kind, source_ref, from_name, to_name, occurred_at, payee, memo, amount_a, currency_a, base_a, fx_a, amount_b, currency_b, base_b, fx_b, dedupe_hash, raw_payload) select 'transfer', source_ref, from_name, to_name, date, payee, memo, from_amount, from_currency, from_base, from_fx, to_amount, to_currency, to_base, to_fx, dedupe, raw_payload from jsonb_to_recordset($1::jsonb) as x(source_ref text, from_name text, to_name text, date date, payee text, memo text, from_amount bigint, from_currency text, from_base bigint, from_fx numeric, to_amount bigint, to_currency text, to_base bigint, to_fx numeric, dedupe text, raw_payload text)`, [JSON.stringify(transferPayload)]);
      const doSql = `do $$ declare r record; from_id uuid; to_id uuid; category_id uuid; ingest_id uuid; txn_id uuid; begin for r in select * from budget_migration_rows order by kind, occurred_at, source_ref loop if r.kind = 'ledger' then select id into from_id from accounts where user_id = $1 and name = r.account_name and role in ('asset','liability'); select id into category_id from accounts where user_id = $1 and name = r.category_name and role = r.category_role::account_role; insert into ingest_events (user_id, kind, account_id, raw_payload) values ($1, 'csv', from_id, r.raw_payload) returning id into ingest_id; insert into transactions (user_id, occurred_at, payee, memo, source, status, source_ref, dedupe_hash, ingest_event_id) values ($1, r.occurred_at, r.payee, r.memo, 'csv', 'confirmed', r.source_ref, r.dedupe_hash, ingest_id) returning id into txn_id; insert into entries (transaction_id, account_id, amount_minor, currency, base_amount_minor, fx_rate_to_base) values (txn_id, from_id, r.amount_a, r.currency_a, r.base_a, r.fx_a), (txn_id, category_id, r.amount_b, 'PHP', r.base_b, 1); else select id into from_id from accounts where user_id = $1 and name = r.from_name and role in ('asset','liability'); select id into to_id from accounts where user_id = $1 and name = r.to_name and role in ('asset','liability'); insert into ingest_events (user_id, kind, account_id, raw_payload) values ($1, 'csv', from_id, r.raw_payload) returning id into ingest_id; insert into transactions (user_id, occurred_at, payee, memo, source, status, source_ref, dedupe_hash, ingest_event_id) values ($1, r.occurred_at, r.payee, r.memo, 'csv', 'confirmed', r.source_ref, r.dedupe_hash, ingest_id) returning id into txn_id; insert into entries (transaction_id, account_id, amount_minor, currency, base_amount_minor, fx_rate_to_base) values (txn_id, from_id, r.amount_a, r.currency_a, r.base_a, r.fx_a), (txn_id, to_id, r.amount_b, r.currency_b, r.base_b, r.fx_b); end if; end loop; end $$`.replaceAll("$1", `'${userId}'`);
      await sql.query(doSql);
      await sql.query("commit");
      console.log(JSON.stringify({ range: [offset, end], ledgerRows: ledgerRows.length, transferRows: transferRows.length, ledgerPosted: ledger.length, transferPosted: transfers.length, accounts: accounts.length, categories: categories.length }, null, 2));
    } catch (error) { await sql.query("rollback"); throw error; }
  });
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : "Batch migration failed"); process.exitCode = 1; });
