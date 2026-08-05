import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  pgView,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Mirrors db/schema.sql. That SQL file remains the authoritative DDL.
export const accountRole = pgEnum("account_role", [
  "asset",
  "liability",
  "expense",
  "income",
  "equity",
]);

export const accountKind = pgEnum("account_kind", [
  "cash",
  "bank",
  "ewallet",
  "credit_card",
  "brokerage",
  "receivable",
  "payable",
  "category",
]);

export const txnSource = pgEnum("txn_source", [
  "manual",
  "snap",
  "receipt",
  "voice",
  "email",
  "csv",
  "statement",
  "unbilled",
  "sms",
  "ibkr",
  "recurring",
]);

export const txnStatus = pgEnum("txn_status", [
  "confirmed",
  "pending_review",
  "stub",
  "duplicate_merged",
]);

export const splitShareType = pgEnum("split_share_type", ["equal", "exact", "pct", "shares"]);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    role: accountRole("role").notNull(),
    kind: accountKind("kind").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    parentId: uuid("parent_id").references((): AnyPgColumn => accounts.id, { onDelete: "set null" }),
    personId: uuid("person_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("category_role_matches", sql`${table.kind} <> 'category' or ${table.role} in ('expense', 'income')`),
    check("counterparty_role_matches", sql`${table.kind} not in ('receivable', 'payable') or ${table.role} in ('asset', 'liability')`),
  ],
);

export const people = pgTable("people", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  contact: text("contact"),
  linkedUserId: uuid("linked_user_id"),
  receivableAccountId: uuid("receivable_account_id").references(() => accounts.id, {
    onDelete: "restrict",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const groups = pgTable("groups", {
  id: uuid("id").defaultRandom().primaryKey(), userId: uuid("user_id").notNull(), name: text("name").notNull(),
  currency: char("currency", { length: 3 }).notNull().default("PHP"), simplifyDebtsEnabled: boolean("simplify_debts_enabled").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const groupMembers = pgTable("group_members", {
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  defaultShareWeight: numeric("default_share_weight", { precision: 10, scale: 4 }).notNull().default("1"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("group_members_person_idx").on(table.personId)]);

export const ingestEvents = pgTable("ingest_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  kind: txnSource("kind").notNull(),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "restrict" }),
  rawPayload: text("raw_payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    occurredAt: date("occurred_at").notNull(),
    payee: text("payee"),
    memo: text("memo"),
    source: txnSource("source").notNull().default("manual"),
    status: txnStatus("status").notNull().default("confirmed"),
    confidence: real("confidence"),
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
    sourceRef: text("source_ref"),
    dedupeHash: text("dedupe_hash"),
    reducedKey: text("reduced_key"),
    seenUnbilledAt: timestamp("seen_unbilled_at", { withTimezone: true }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    ingestEventId: uuid("ingest_event_id").references(() => ingestEvents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("txn_user_date_idx").on(table.userId, table.occurredAt.desc()),
    index("txn_dedupe_idx").on(table.userId, table.dedupeHash).where(sql`${table.dedupeHash} is not null`),
    index("txn_reduced_idx").on(table.userId, table.reducedKey).where(sql`${table.reducedKey} is not null`),
    index("txn_ingest_event_idx").on(table.ingestEventId),
    index("txn_group_idx").on(table.groupId).where(sql`${table.groupId} is not null`),
    uniqueIndex("txn_user_source_ref_unique_idx").on(table.userId, table.sourceRef).where(sql`${table.sourceRef} is not null`),
  ],
);

export const splits = pgTable("splits", {
  id: uuid("id").defaultRandom().primaryKey(),
  transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  shareMinor: bigint("share_minor", { mode: "bigint" }).notNull(), shareType: splitShareType("share_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("splits_transaction_idx").on(table.transactionId), index("splits_person_idx").on(table.personId), check("splits_share_nonzero", sql`${table.shareMinor} <> 0`)]);

export const entries = pgTable(
  "entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    baseAmountMinor: bigint("base_amount_minor", { mode: "bigint" }).notNull(),
    fxRateToBase: numeric("fx_rate_to_base", { precision: 18, scale: 8 })
      .notNull()
      .default("1"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("entries_transaction_idx").on(table.transactionId),
    index("entries_account_idx").on(table.accountId),
    check("entry_nonzero", sql`${table.amountMinor} <> 0`),
    check("php_needs_no_conversion", sql`${table.currency} <> 'PHP' or (${table.baseAmountMinor} = ${table.amountMinor} and ${table.fxRateToBase} = 1)`),
  ],
);

export const accountBalances = pgView("account_balances", {
  accountId: uuid("account_id"),
  userId: uuid("user_id"),
  name: text("name"),
  role: accountRole("role"),
  kind: accountKind("kind"),
  balanceMinor: bigint("balance_minor", { mode: "bigint" }),
  displayBalanceMinor: bigint("display_balance_minor", { mode: "bigint" }),
}).existing();

export const categorySpend = pgView("category_spend", {
  categoryId: uuid("category_id"),
  userId: uuid("user_id"),
  category: text("category"),
  occurredAt: date("occurred_at"),
  spentMinor: bigint("spent_minor", { mode: "bigint" }),
}).existing();

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    rolloverEnabled: boolean("rollover_enabled").notNull().default(false),
    startsOn: date("starts_on").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("budget_amount_positive", sql`${table.amountMinor} > 0`),
    check("budget_starts_on_first_of_month", sql`extract(day from ${table.startsOn}) = 1`),
    uniqueIndex("budgets_user_account_active_idx").on(table.userId, table.accountId).where(sql`${table.archivedAt} is null`),
  ],
);
