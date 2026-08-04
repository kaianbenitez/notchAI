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

const HEADERS = [
  "Ledger", "Category", "Subcategory", "Currency", "Price", "Account",
  "Recorder", "Date", "Time", "Tag", "Note", "Transaction",
] as const;

type CsvHeader = (typeof HEADERS)[number];
type CsvRow = Record<CsvHeader, string>;

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

const ACCOUNT_MAP: Record<string, AccountDefinition> = {
  UB: { name: "UB", kind: "bank", role: "asset", currency: "PHP" },
  "BPI Gold Rewards/Amore": {
    name: "BPI Gold Rewards/Amore", kind: "credit_card", role: "liability", currency: "PHP",
  },
  "RCBC Flex Gold Visa": {
    name: "RCBC Flex Gold Visa", kind: "credit_card", role: "liability", currency: "PHP",
  },
  "Flex Gold": {
    name: "RCBC Flex Gold Visa", kind: "credit_card", role: "liability", currency: "PHP",
  },
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
  "": { name: "Unassigned", kind: "bank", role: "asset", currency: "PHP" },
};

const CATEGORY_MAP: Record<string, CategoryDefinition> = {
  Shopping: { name: "Shopping", role: "expense" },
  "Health & Fitness": { name: "Health & Fitness", role: "expense" },
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
  Uncategorized: { name: "Uncategorized", role: "expense" },
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
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field !== "") throw new Error("CSV has an invalid quoted field");
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV has an unterminated quoted field");
  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function parseRows(input: string): CsvRow[] {
  const records = parseCsv(input.replace(/^\uFEFF/, ""));
  const header = records.shift();
  if (!header || header.length !== HEADERS.length || !HEADERS.every((name, index) => header[index] === name)) {
    throw new Error("CSV headers do not match the expected export format");
  }
  return records.map((record, index) => {
    if (record.length !== HEADERS.length) throw new Error(`CSV row ${index + 2} has the wrong number of columns`);
    return Object.fromEntries(HEADERS.map((headerName, column) => [headerName, record[column]])) as CsvRow;
  });
}

async function findExisting(
  sql: Sql,
  userId: string,
  name: string,
  role: AccountRole,
): Promise<Account | null> {
  const { rows } = await sql.query<Account[]>(
    `select id, user_id as "userId", name, role, kind, currency,
            parent_id as "parentId", person_id as "personId", archived_at as "archivedAt"
       from accounts
      where user_id = $1 and role = $2 and lower(name) = lower($3) and archived_at is null
      limit 1`,
    [userId, role, name],
  );
  return rows[0] ?? null;
}

function memoFor(row: CsvRow, payeeUsesNote: boolean): string | null {
  const parts: string[] = [];
  const subcategory = row.Subcategory.trim();
  const tag = row.Tag.trim();
  if (payeeUsesNote && subcategory) parts.push(subcategory);
  if (tag) parts.push(`Tag: ${tag}`);
  return parts.join(" · ") || null;
}

function expectedCategoryRole(transaction: string): "expense" | "income" {
  if (transaction === "Income") return "income";
  if (transaction === "Expense" || transaction === "Subscription") return "expense";
  throw new Error("CSV row has an unsupported transaction type");
}

async function main(): Promise<void> {
  process.loadEnvFile?.();
  const [csvPath] = process.argv.slice(2);
  if (!csvPath || process.argv.length !== 3 || !isAbsolute(csvPath)) {
    throw new Error("Usage: npx tsx scripts/import-csv-history.ts <absolute-path-to-csv>");
  }

  const rows = parseRows(await readFile(resolve(csvPath), "utf8"));
  const userId = currentUserId();
  let accountsCreated = 0;
  let categoriesCreated = 0;
  let transactionsPosted = 0;
  const transactionsByAccount = new Map<string, number>();

  await withDb(async (sql) => {
    const accounts = new Map<string, Account>();
    const categories = new Map<string, Account>();

    for (const [rowIndex, row] of rows.entries()) {
      const accountDefinition = ACCOUNT_MAP[row.Account.trim()];
      const categoryDefinition = CATEGORY_MAP[row.Category.trim()];
      const expectedRole = expectedCategoryRole(row.Transaction.trim());
      if (!accountDefinition) throw new Error(`Row ${rowIndex + 2} has an unmapped account`);
      if (!categoryDefinition || categoryDefinition.role !== expectedRole) {
        throw new Error(`Row ${rowIndex + 2} has an unmapped or incompatible category`);
      }

      let account = accounts.get(accountDefinition.name);
      if (!account) {
        const existing = await findExisting(sql, userId, accountDefinition.name, accountDefinition.role);
        account = existing ?? await createAccount(sql, { userId, ...accountDefinition });
        if (!existing) accountsCreated += 1;
        accounts.set(accountDefinition.name, account);
      }

      const categoryKey = `${categoryDefinition.role}:${categoryDefinition.name}`;
      let category = categories.get(categoryKey);
      if (!category) {
        const existing = await findExisting(sql, userId, categoryDefinition.name, categoryDefinition.role);
        category = existing ?? await createCategory(sql, {
          userId,
          name: categoryDefinition.name,
          role: categoryDefinition.role,
        });
        if (!existing) categoriesCreated += 1;
        categories.set(categoryKey, category);
      }

      let nativeAmountMinor: number;
      try {
        nativeAmountMinor = parseAmountToMinor(row.Price);
      } catch {
        throw new Error(`Row ${rowIndex + 2} has an invalid price`);
      }
      if (nativeAmountMinor <= 0) throw new Error(`Row ${rowIndex + 2} must have a positive price`);

      const isIncome = expectedRole === "income";
      const accountSign = isIncome ? nativeAmountMinor : -nativeAmountMinor;
      const payeeFromNote = row.Note.trim();
      const payee = payeeFromNote || row.Subcategory.trim() || categoryDefinition.name;
      const memo = memoFor(row, Boolean(payeeFromNote));
      const nativeCurrency = row.Currency.trim().toUpperCase();
      const wiseUsd = row.Account.trim() === "Wise" && nativeCurrency === "USD";
      const mayaSavingsUsd = row.Account.trim() === "Maya Savings" && nativeCurrency === "USD";
      const baseAmountMinor = wiseUsd || mayaSavingsUsd ? nativeAmountMinor * 58 : nativeAmountMinor;
      const accountLegAmountMinor = wiseUsd ? nativeAmountMinor : baseAmountMinor;
      const accountLegCurrency = wiseUsd ? "USD" : "PHP";

      const { rows: ingestRows } = await sql.query<{ id: string }>(
        `insert into ingest_events (user_id, kind, account_id, raw_payload)
         values ($1, 'csv', $2, $3)
         returning id`,
        [userId, account.id, JSON.stringify(row)],
      );

      await postTransaction(
        sql,
        {
          userId,
          occurredAt: row.Date,
          payee,
          memo,
          source: "csv",
          status: "confirmed",
          ingestEventId: ingestRows[0]?.id,
          dedupeHash: dedupeHash(payee, accountLegAmountMinor, accountLegCurrency, row.Date),
        },
        wiseUsd
          ? [
              { accountId: account.id, amountMinor: accountSign, currency: "USD", fxRateToBase: 58 },
              { accountId: category.id, amountMinor: -accountSign * 58 },
            ]
          : [
              { accountId: account.id, amountMinor: mayaSavingsUsd ? (isIncome ? baseAmountMinor : -baseAmountMinor) : accountSign },
              { accountId: category.id, amountMinor: isIncome ? -baseAmountMinor : baseAmountMinor },
            ],
      );

      transactionsPosted += 1;
      transactionsByAccount.set(accountDefinition.name, (transactionsByAccount.get(accountDefinition.name) ?? 0) + 1);
    }
  });

  console.log(`Rows processed: ${rows.length}`);
  console.log(`Accounts created: ${accountsCreated}`);
  console.log(`Categories created: ${categoriesCreated}`);
  console.log(`Transactions posted: ${transactionsPosted}`);
  for (const [name, count] of transactionsByAccount) console.log(`${name}: ${count}`);
}

void main().catch(() => {
  console.error("Import failed. No source transaction details were printed.");
  process.exitCode = 1;
});
