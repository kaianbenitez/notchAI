import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
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
export const netWorthCategory = pgEnum("net_worth_category", ["cash", "investment", "property", "vehicle", "other"]);

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

export const recurringRules = pgTable("recurring_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  rrule: text("rrule").notNull(),
  expectedAmountMinor: bigint("expected_amount_minor", { mode: "bigint" }).notNull(),
  tolerancePct: numeric("tolerance_pct").notNull().default("0"),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
  categoryId: uuid("category_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
  nextDueOn: date("next_due_on").notNull(),
  autopay: boolean("autopay").notNull().default(false),
  lastMatchedTxnId: uuid("last_matched_txn_id").references(() => transactions.id, { onDelete: "set null" }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("recurring_rule_amount_positive", sql`${table.expectedAmountMinor} > 0`)]);

export const reminders = pgTable("reminders", {
  id: uuid("id").defaultRandom().primaryKey(),
  ruleId: uuid("rule_id").notNull().references(() => recurringRules.id, { onDelete: "cascade" }),
  cycleDueOn: date("cycle_due_on").notNull(),
  rung: text("rung").notNull(),
  fireAt: date("fire_at").notNull(),
  channel: text("channel").notNull().default("telegram"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("reminders_rung_check", sql`${table.rung} in ('t_minus_5', 't_minus_1', 'due', 'overdue')`),
  uniqueIndex("reminders_rule_fire_at_unique_idx").on(table.ruleId, table.fireAt),
]);

export const dismissedBillSuggestions = pgTable("dismissed_bill_suggestions", {
  userId: uuid("user_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("dismissed_bill_suggestions_pkey").on(table.userId, table.fingerprint)]);

export const captureNudges = pgTable("capture_nudges", {
  nudgeDate: date("nudge_date").primaryKey(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const creditCardStatementSettings = pgTable("credit_card_statement_settings", {
  userId: uuid("user_id").notNull(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  cutoffDay: integer("cutoff_day").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("credit_card_statement_settings_user_account_idx").on(table.userId, table.accountId),
  check("credit_card_statement_cutoff_day", sql`${table.cutoffDay} between 1 and 28`),
]);

export const creditCardStatements = pgTable("credit_card_statements", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
  periodStartsOn: date("period_starts_on").notNull(),
  periodEndsOn: date("period_ends_on").notNull(),
  statementAmountMinor: bigint("statement_amount_minor", { mode: "bigint" }).notNull(),
  dueOn: date("due_on").notNull(),
  status: text("status").notNull().default("active"),
  paidTransactionId: uuid("paid_transaction_id").references(() => transactions.id, { onDelete: "set null" }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("credit_card_statement_amount_positive", sql`${table.statementAmountMinor} > 0`),
  check("credit_card_statement_status", sql`${table.status} in ('active', 'paid')`),
  check("credit_card_statement_period", sql`${table.periodStartsOn} <= ${table.periodEndsOn}`),
  index("credit_card_statements_active_idx").on(table.userId, table.status, table.dueOn),
  uniqueIndex("credit_card_statements_one_active_per_card_idx").on(table.userId, table.accountId).where(sql`${table.status} = 'active'`),
]);

export const creditCardStatementReminders = pgTable("credit_card_statement_reminders", {
  id: uuid("id").defaultRandom().primaryKey(),
  statementId: uuid("statement_id").notNull().references(() => creditCardStatements.id, { onDelete: "cascade" }),
  rung: text("rung").notNull(),
  fireAt: date("fire_at").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("credit_card_statement_reminder_rung", sql`${table.rung} in ('t_minus_5', 't_minus_1', 'due', 'overdue')`),
  uniqueIndex("credit_card_statement_reminders_statement_fire_at_idx").on(table.statementId, table.fireAt),
]);

export const gmailSyncCursors = pgTable("gmail_sync_cursors", {
  userId: uuid("user_id").primaryKey(), historyId: text("history_id"),
  lastSuccessfulAt: timestamp("last_successful_at", { withTimezone: true }).notNull().defaultNow(),
});

export const gmailAccountAliases = pgTable("gmail_account_aliases", {
  userId: uuid("user_id").notNull(), descriptor: text("descriptor").notNull(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("gmail_account_aliases_pkey").on(table.userId, table.descriptor)]);

export const gmailPayeeAliases = pgTable("gmail_payee_aliases", {
  userId: uuid("user_id").notNull(), descriptor: text("descriptor").notNull(),
  categoryId: uuid("category_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("gmail_payee_aliases_pkey").on(table.userId, table.descriptor)]);

export const gmailIngestItems = pgTable("gmail_ingest_items", {
  id: uuid("id").defaultRandom().primaryKey(), userId: uuid("user_id").notNull(), gmailMessageId: text("gmail_message_id").notNull(),
  ingestEventId: uuid("ingest_event_id").notNull().references(() => ingestEvents.id, { onDelete: "restrict" }),
  accountDescriptor: text("account_descriptor"), payeeDescriptor: text("payee_descriptor"), occurredAt: date("occurred_at"), amountMinor: bigint("amount_minor", { mode: "bigint" }),
  direction: text("direction"), accountId: uuid("account_id").references(() => accounts.id, { onDelete: "restrict" }), categoryId: uuid("category_id").references(() => accounts.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("pending_review"), transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (table) => [uniqueIndex("gmail_ingest_items_user_message_unique_idx").on(table.userId, table.gmailMessageId), index("gmail_ingest_items_review_idx").on(table.userId, table.status, table.createdAt.desc())]);

export const netWorthLabels = pgTable("net_worth_labels", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  category: netWorthCategory("category").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("net_worth_labels_user_name_unique").on(table.userId, table.name)]);

export const netWorthSnapshots = pgTable("net_worth_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  labelId: uuid("label_id").notNull().references(() => netWorthLabels.id, { onDelete: "cascade" }),
  balanceMinor: bigint("balance_minor", { mode: "bigint" }).notNull(),
  currency: char("currency", { length: 3 }).notNull().default("PHP"),
  asOf: date("as_of").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("net_worth_balance_nonnegative", sql`${table.balanceMinor} >= 0`),
  index("net_worth_snapshots_label_idx").on(table.labelId, table.asOf.desc(), table.createdAt.desc()),
]);

export const netWorthCurrent = pgView("net_worth_current", {
  labelId: uuid("label_id"),
  userId: uuid("user_id"),
  label: text("label"),
  category: netWorthCategory("category"),
  balanceMinor: bigint("balance_minor", { mode: "bigint" }),
  currency: char("currency", { length: 3 }),
  asOf: date("as_of"),
}).existing();

export const savingsGoals = pgTable("savings_goals", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  targetMinor: bigint("target_minor", { mode: "bigint" }).notNull(),
  currency: char("currency", { length: 3 }).notNull().default("PHP"),
  linkedLabelId: uuid("linked_label_id").references(() => netWorthLabels.id, { onDelete: "set null" }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("savings_goal_target_positive", sql`${table.targetMinor} > 0`)]);
