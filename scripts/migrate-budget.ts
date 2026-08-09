import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import {
  createAccount,
  createCategory,
  type Account,
  type AccountKind,
  type AccountRole,
} from "../src/accounts/repo";
import { currentUserId } from "../src/auth";
import { withDb } from "../src/db/client";
import { dedupeHash } from "../src/import/match";
import { postTransaction, type Sql } from "../src/ledger/post";
import { parseAmountToMinor } from "../src/money";

export const LEDGER_HEADERS = [
  "Ledger", "Category", "Subcategory", "Currency", "Price", "Account",
  "Recorder", "Date", "Time", "Tag", "Note", "Transaction",
] as const;
export const TRANSFER_HEADERS = ["From", "To", "Currency", "Price", "Date", "Time", "Note"] as const;

type LedgerHeader = (typeof LEDGER_HEADERS)[number];
type TransferHeader = (typeof TRANSFER_HEADERS)[number];
type CsvRow<H extends readonly string[]> = Record<H[number], string>;
export type LedgerRow = CsvRow<typeof LEDGER_HEADERS>;
export type TransferRow = CsvRow<typeof TRANSFER_HEADERS>;

interface AccountDefinition {
  name: string;
  kind: AccountKind;
  role: AccountRole;
  currency: string;
}

interface CategoryDefinition {
  name: string;
  role: "expense" | "income";
}

export const ACCOUNT_MAP: Record<string, AccountDefinition> = {
  UB: { name: "UB", kind: "bank", role: "asset", currency: "PHP" },
  "BPI Gold Rewards/Amore": { name: "BPI Gold Rewards/Amore", kind: "credit_card", role: "liability", currency: "PHP" },
  "RCBC Flex Gold Visa": { name: "RCBC Flex Gold Visa", kind: "credit_card", role: "liability", currency: "PHP" },
  "Flex Gold": { name: "RCBC Flex Gold Visa", kind: "credit_card", role: "liability", currency: "PHP" },
  "Amore Cashback": { name: "BPI Gold Rewards/Amore", kind: "credit_card", role: "liability", currency: "PHP" },
  "BPI CC": { name: "BPI Gold Rewards/Amore", kind: "credit_card", role: "liability", currency: "PHP" },
  BPI: { name: "BPI", kind: "bank", role: "asset", currency: "PHP" },
  Wise: { name: "Wise", kind: "bank", role: "asset", currency: "USD" },
  Cash: { name: "Cash", kind: "cash", role: "asset", currency: "PHP" },
  Vybe: { name: "Vybe", kind: "ewallet", role: "asset", currency: "PHP" },
  "Maya Landers": { name: "Maya Landers", kind: "ewallet", role: "asset", currency: "PHP" },
  MariBank: { name: "MariBank", kind: "bank", role: "asset", currency: "PHP" },
  "Metro bank": { name: "Metro bank", kind: "bank", role: "asset", currency: "PHP" },
  Gcash: { name: "Gcash", kind: "ewallet", role: "asset", currency: "PHP" },
  "Maya Savings": { name: "Maya Savings", kind: "bank", role: "asset", currency: "PHP" },
  Inventory: { name: "Inventory", kind: "bank", role: "asset", currency: "PHP" },
  Spaylater: { name: "Spaylater", kind: "credit_card", role: "liability", currency: "PHP" },
  "MC Wave Titanium": { name: "MC Wave Titanium", kind: "credit_card", role: "liability", currency: "PHP" },
  "Starbucks Card": { name: "Starbucks Card", kind: "ewallet", role: "asset", currency: "PHP" },
  IBKR: { name: "IBKR", kind: "brokerage", role: "asset", currency: "USD" },
  MP2: { name: "MP2", kind: "brokerage", role: "asset", currency: "PHP" },
  "Out Source": { name: "Out Source", kind: "bank", role: "asset", currency: "PHP" },
  "": { name: "Cash", kind: "cash", role: "asset", currency: "PHP" },
};

export const CATEGORY_MAP: Record<string, CategoryDefinition> = {
  Shopping: { name: "Shopping", role: "expense" },
  "Health & Fitness": { name: "Health & Fitness", role: "expense" },
  "Health and Fitness": { name: "Health & Fitness", role: "expense" },
  Bills: { name: "Bills", role: "expense" },
  Transportation: { name: "Transportation", role: "expense" },
  Transport: { name: "Transportation", role: "expense" },
  "Food & Drink": { name: "Food & Drink", role: "expense" },
  Salary: { name: "Salary", role: "income" },
  "Leisure & Experiences": { name: "Leisure & Experiences", role: "expense" },
  Leisure: { name: "Leisure & Experiences", role: "expense" },
  iCloud: { name: "iCloud", role: "expense" },
  Spotify: { name: "Spotify", role: "expense" },
  "Subscription & Digital": { name: "Subscription & Digital", role: "expense" },
  "Subscriptions & Digital": { name: "Subscription & Digital", role: "expense" },
  Subscription: { name: "Subscription & Digital", role: "expense" },
  "Pet Care": { name: "Pet Care", role: "expense" },
  "Self and Pet Care": { name: "Pet Care", role: "expense" },
  Side: { name: "Side", role: "income" },
};

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') { field += '"'; index += 1; } else quoted = false;
      } else field += character;
      continue;
    }
    if (character === '"') {
      if (field !== "") throw new Error("CSV has an invalid quoted field");
      quoted = true;
    } else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field); if (row.some((value) => value !== "")) rows.push(row); row = []; field = "";
    } else field += character;
  }
  if (quoted) throw new Error("CSV has an unterminated quoted field");
  row.push(field); if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

export function parseRows<H extends readonly string[]>(input: string, headers: H): CsvRow<H>[] {
  const records = parseCsv(input.replace(/^\uFEFF/, ""));
  const header = records.shift();
  if (!header || header.length !== headers.length || !headers.every((name, index) => header[index] === name)) {
    throw new Error("CSV headers do not match the expected export format");
  }
  return records.map((record, index) => {
    if (record.length !== headers.length) throw new Error(`CSV row ${index + 2} has the wrong number of columns`);
    return Object.fromEntries(headers.map((name, column) => [name, record[column]])) as CsvRow<H>;
  });
}

export function accountDefinition(sourceName: string): AccountDefinition {
  const definition = ACCOUNT_MAP[sourceName.trim()];
  if (!definition) throw new Error(`Unmapped account: ${sourceName}`);
  return definition;
}

export function categoryDefinition(row: LedgerRow): CategoryDefinition {
  const source = row.Category.trim();
  if (source === "Uncategorized") {
    const text = `${row.Note} ${row.Subcategory}`.toLowerCase();
    if (/watson|medical|health/.test(text)) return CATEGORY_MAP["Health & Fitness"];
    if (/meralco|pldt|smart app|smart /.test(text)) return CATEGORY_MAP.Bills;
    if (/supermarket|baking|abenson/.test(text)) return /abenson/.test(text) ? CATEGORY_MAP.Shopping : CATEGORY_MAP["Food & Drink"];
    return CATEGORY_MAP.Shopping;
  }
  const definition = CATEGORY_MAP[source];
  if (!definition) throw new Error(`Unmapped category: ${source}`);
  return definition;
}

export function expectedRole(transaction: string): "expense" | "income" | "refund" {
  if (transaction === "Income") return "income";
  if (transaction === "Refund") return "refund";
  if (transaction === "Expense" || transaction === "Subscription") return "expense";
  throw new Error(`Unsupported transaction type: ${transaction}`);
}

export function exactKey(row: Record<string, string>): string { return Object.values(row).join("\u0001"); }

async function findExisting(sql: Sql, userId: string, name: string, role: AccountRole): Promise<Account | null> {
  const { rows } = await sql.query<Account[]>(
    `select id, user_id as "userId", name, role, kind, currency, parent_id as "parentId", person_id as "personId", archived_at as "archivedAt"
       from accounts where user_id = $1 and role = $2 and lower(name) = lower($3) and archived_at is null limit 1`,
    [userId, role, name],
  );
  return rows[0] ?? null;
}

async function getAccount(sql: Sql, userId: string, cache: Map<string, Account>, definition: AccountDefinition): Promise<Account> {
  const cached = cache.get(`${definition.role}:${definition.name}`);
  if (cached) return cached;
  const account = await findExisting(sql, userId, definition.name, definition.role) ?? await createAccount(sql, { userId, ...definition });
  cache.set(`${definition.role}:${definition.name}`, account);
  return account;
}

async function getCategory(sql: Sql, userId: string, cache: Map<string, Account>, definition: CategoryDefinition): Promise<Account> {
  const key = `${definition.role}:${definition.name}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const category = await findExisting(sql, userId, definition.name, definition.role) ?? await createCategory(sql, { userId, name: definition.name, role: definition.role });
  cache.set(key, category);
  return category;
}

async function resetUser(sql: Sql, userId: string): Promise<void> {
  const statements = [
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
  for (const statement of statements) await sql.query(statement, [userId]);
}

function migrationSql(sql: Sql): Sql {
  return {
    async query<T = unknown>(text: string, params?: unknown[]) {
      if (text === "begin") return sql.query<T>("savepoint budget_migration_post");
      if (text === "commit") return sql.query<T>("release savepoint budget_migration_post");
      if (text === "rollback") {
        await sql.query("rollback to savepoint budget_migration_post");
        return sql.query<T>("release savepoint budget_migration_post");
      }
      return sql.query<T>(text, params);
    },
  };
}

function validate(ledger: LedgerRow[], transfers: TransferRow[]): void {
  const seenLedger = new Set<string>();
  for (const [index, row] of ledger.entries()) {
    accountDefinition(row.Account);
    const category = categoryDefinition(row);
    const role = expectedRole(row.Transaction.trim());
    if (role !== "refund" && category.role !== role) throw new Error(`Ledger row ${index + 2} has incompatible category`);
    parseAmountToMinor(row.Price);
    if (seenLedger.has(exactKey(row))) continue;
    seenLedger.add(exactKey(row));
  }
  const seenTransfers = new Set<string>();
  for (const [index, row] of transfers.entries()) {
    accountDefinition(row.From); accountDefinition(row.To); parseAmountToMinor(row.Price);
    if (seenTransfers.has(exactKey(row))) continue;
    seenTransfers.add(exactKey(row));
  }
}

async function main(): Promise<void> {
  process.loadEnvFile?.();
  const args = process.argv.slice(2);
  const reset = args[0] === "--reset";
  const paths = reset ? args.slice(1) : args;
  if (paths.length !== 2 || paths.some((path) => !isAbsolute(path))) throw new Error("Usage: npx tsx scripts/migrate-budget.ts --reset <ledger.csv> <transfers.csv>");
  const ledger = parseRows(await readFile(resolve(paths[0]), "utf8"), LEDGER_HEADERS);
  const transfers = parseRows(await readFile(resolve(paths[1]), "utf8"), TRANSFER_HEADERS);
  validate(ledger, transfers);
  if (!reset) { console.log(`Validated ${ledger.length} ledger rows and ${transfers.length} transfer rows. No database changes made.`); return; }

  const userId = currentUserId();
  await withDb(async (sql) => {
    await sql.query("begin");
    const migration = migrationSql(sql);
    try {
      await resetUser(migration, userId);
    const accounts = new Map<string, Account>();
    const categories = new Map<string, Account>();
    const seenLedger = new Set<string>();
    const seenTransfers = new Set<string>();
    let ledgerPosted = 0; let transferPosted = 0; let duplicatesSkipped = 0;

    for (const [index, row] of ledger.entries()) {
      const key = exactKey(row);
      if (seenLedger.has(key)) { duplicatesSkipped += 1; continue; }
      seenLedger.add(key);
      const account = await getAccount(migration, userId, accounts, accountDefinition(row.Account));
      const category = await getCategory(migration, userId, categories, categoryDefinition(row));
      const amount = parseAmountToMinor(row.Price);
      const role = expectedRole(row.Transaction.trim());
      const refund = role === "refund";
      const isIncome = role === "income";
      const sourceCurrency = row.Currency.trim().toUpperCase();
      const foreign = sourceCurrency !== "PHP";
      const fxRate = foreign ? 58 : 1;
      const amountBase = Math.round(amount * fxRate);
      const accountCurrency = account.currency === "USD" ? "USD" : "PHP";
      const accountFxRate = accountCurrency === "USD" ? 58 : 1;
      const accountAmount = accountCurrency === "USD" ? Math.round(amountBase / accountFxRate) : amountBase;
      const accountEntryAmount = refund || isIncome ? accountAmount : -accountAmount;
      const categoryEntryAmount = refund ? -amountBase : isIncome ? -amountBase : amountBase;
      const payee = row.Note.trim() || row.Subcategory.trim() || category.name;
      const { rows: ingestRows } = await migration.query<{ id: string }>(`insert into ingest_events (user_id, kind, account_id, raw_payload) values ($1, 'csv', $2, $3) returning id`, [userId, account.id, JSON.stringify(row)]);
      await postTransaction(migration, { userId, occurredAt: row.Date, payee, memo: row.Tag.trim() ? `Tag: ${row.Tag.trim()}` : null, source: "csv", status: "confirmed", ingestEventId: ingestRows[0].id, sourceRef: `budget-migration:ledger:${index}`, dedupeHash: dedupeHash(payee, accountAmount, accountCurrency, row.Date) }, [
        { accountId: account.id, amountMinor: accountEntryAmount, currency: accountCurrency, ...(accountCurrency === "USD" ? { fxRateToBase: accountFxRate } : {}) },
        { accountId: category.id, amountMinor: categoryEntryAmount },
      ]);
      ledgerPosted += 1;
    }

    for (const [index, row] of transfers.entries()) {
      const key = exactKey(row);
      if (seenTransfers.has(key)) { duplicatesSkipped += 1; continue; }
      seenTransfers.add(key);
      const from = await getAccount(migration, userId, accounts, accountDefinition(row.From));
      const to = await getAccount(migration, userId, accounts, accountDefinition(row.To));
      const amount = parseAmountToMinor(row.Price);
      const currency = row.Currency.trim().toUpperCase();
      const fxRate = currency === "USD" ? 58 : 1;
      const baseAmount = Math.round(amount * fxRate);
      const fromNative = currency !== "PHP" && from.currency === currency;
      const toNative = currency !== "PHP" && to.currency === currency;
      const fromAmount = fromNative ? -amount : -baseAmount;
      const toAmount = toNative ? amount : baseAmount;
      const fromCurrency = fromNative ? currency : "PHP";
      const toCurrency = toNative ? currency : "PHP";
      const { rows: ingestRows } = await migration.query<{ id: string }>(`insert into ingest_events (user_id, kind, account_id, raw_payload) values ($1, 'csv', $2, $3) returning id`, [userId, from.id, JSON.stringify(row)]);
      await postTransaction(migration, { userId, occurredAt: row.Date, payee: `${from.name} → ${to.name}`, memo: row.Note.trim() || null, source: "csv", status: "confirmed", ingestEventId: ingestRows[0].id, sourceRef: `budget-migration:transfer:${index}`, dedupeHash: dedupeHash(`${from.name} → ${to.name}`, amount, currency, row.Date) }, [
        { accountId: from.id, amountMinor: fromAmount, currency: fromCurrency, ...(fromCurrency === "USD" ? { fxRateToBase: fxRate } : {}) },
        { accountId: to.id, amountMinor: toAmount, currency: toCurrency, ...(toCurrency === "USD" ? { fxRateToBase: fxRate } : {}) },
      ]);
      transferPosted += 1;
    }
      await sql.query("commit");
      console.log(JSON.stringify({ userId, ledgerRows: ledger.length, transferRows: transfers.length, ledgerPosted, transferPosted, duplicatesSkipped, accounts: accounts.size, categories: categories.size }, null, 2));
    } catch (error) {
      await sql.query("rollback");
      throw error;
    }
  });
}

if (process.argv[1]?.endsWith("scripts/migrate-budget.ts")) {
  void main().catch((error) => { console.error(error instanceof Error ? error.message : "Migration failed"); process.exitCode = 1; });
}
