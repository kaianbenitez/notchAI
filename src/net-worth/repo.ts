import type { Sql } from "../ledger/post";

export const NET_WORTH_CATEGORIES = ["cash", "investment", "property", "vehicle", "other"] as const;
export type NetWorthCategory = (typeof NET_WORTH_CATEGORIES)[number];

export interface NetWorthBalance {
  labelId: string;
  userId: string;
  label: string;
  category: NetWorthCategory;
  balanceMinor: number;
  currency: string;
  asOf: string;
}

export interface SavingsGoal {
  id: string;
  userId: string;
  name: string;
  targetMinor: number;
  currency: string;
  linkedLabelId: string | null;
  linkedLabel: string | null;
  archivedAt: Date | null;
}

export interface SavingsGoalProgress extends SavingsGoal {
  currentMinor: number;
  progressPercent: number;
}

export class NetWorthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetWorthError";
  }
}

interface BalanceRow {
  label_id: string;
  user_id: string;
  label: string;
  category: string;
  balance_minor: string | number;
  currency: string;
  as_of: string | Date;
}

interface LabelRow {
  id: string;
  user_id: string;
  name: string;
  category: string;
  archived_at: string | Date | null;
}

interface GoalRow {
  id: string;
  user_id: string;
  name: string;
  target_minor: string | number;
  currency: string;
  linked_label_id: string | null;
  linked_label: string | null;
  archived_at: string | Date | null;
  current_minor?: string | number;
}

function integer(value: string | number, field: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new NetWorthError(`${field} is outside the supported integer range`);
  return result;
}

function isoDate(value: string | Date): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function assertCategory(category: string): asserts category is NetWorthCategory {
  if (!NET_WORTH_CATEGORIES.includes(category as NetWorthCategory)) {
    throw new NetWorthError("choose a valid net-worth category");
  }
}

function assertName(name: string, kind: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new NetWorthError(`${kind} name cannot be blank`);
  return trimmed;
}

function assertMinor(value: number, field: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new NetWorthError(`${field} must be ${minimum === 0 ? "zero or a positive" : "a positive"} whole number of centavos`);
  }
}

function toBalance(row: BalanceRow): NetWorthBalance {
  assertCategory(row.category);
  return {
    labelId: row.label_id,
    userId: row.user_id,
    label: row.label,
    category: row.category,
    balanceMinor: integer(row.balance_minor, "balance"),
    currency: row.currency.trim(),
    asOf: isoDate(row.as_of),
  };
}

function toGoal(row: GoalRow): SavingsGoal {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    targetMinor: integer(row.target_minor, "target"),
    currency: row.currency.trim(),
    linkedLabelId: row.linked_label_id,
    linkedLabel: row.linked_label,
    archivedAt: row.archived_at === null ? null : new Date(row.archived_at),
  };
}

function assertPhp(currency: string | undefined): string {
  const normalized = (currency ?? "PHP").trim().toUpperCase();
  if (normalized !== "PHP") throw new NetWorthError("manual net-worth balances are PHP only");
  return normalized;
}

function assertDate(value: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) {
    throw new NetWorthError("as-of date must be YYYY-MM-DD");
  }
}

/** Latest active balance for each label, ordered for category sections. */
export async function listCurrentBalances(sql: Sql, userId: string): Promise<NetWorthBalance[]> {
  const { rows } = await sql.query<BalanceRow>(
    `select label_id, user_id, label, category, balance_minor, currency, as_of
       from net_worth_current where user_id = $1
      order by category, label`,
    [userId],
  );
  return rows.map(toBalance);
}

/** Active labels, including labels without a first snapshot so goals can target them. */
export async function listNetWorthLabels(sql: Sql, userId: string): Promise<{ id: string; name: string; category: NetWorthCategory }[]> {
  const { rows } = await sql.query<LabelRow>(
    `select id, user_id, name, category, archived_at from net_worth_labels
      where user_id = $1 and archived_at is null order by category, name`,
    [userId],
  );
  return rows.map((row) => {
    assertCategory(row.category);
    return { id: row.id, name: row.name, category: row.category };
  });
}

/** Creates a label only when its case-insensitive name does not already exist. */
export async function recordNetWorthSnapshot(
  sql: Sql,
  input: { userId: string; labelId?: string; labelName?: string; category?: NetWorthCategory; balanceMinor: number; asOf: string; currency?: string },
): Promise<NetWorthBalance> {
  assertMinor(input.balanceMinor, "balance", 0);
  assertDate(input.asOf);
  const currency = assertPhp(input.currency);

  let label: LabelRow | undefined;
  if (input.labelId) {
    const { rows } = await sql.query<LabelRow>(
      `select id, user_id, name, category, archived_at from net_worth_labels where id = $1 and user_id = $2`,
      [input.labelId, input.userId],
    );
    label = rows[0];
    if (!label) throw new NetWorthError("that net-worth label does not exist");
  } else {
    const name = assertName(input.labelName ?? "", "label");
    const { rows } = await sql.query<LabelRow>(
      `select id, user_id, name, category, archived_at from net_worth_labels
        where user_id = $1 and lower(name) = lower($2) limit 1`,
      [input.userId, name],
    );
    label = rows[0];
    if (!label) {
      if (!input.category) throw new NetWorthError("choose a category for a new label");
      assertCategory(input.category);
      const created = await sql.query<LabelRow>(
        `insert into net_worth_labels (user_id, name, category) values ($1, $2, $3)
         returning id, user_id, name, category, archived_at`,
        [input.userId, name, input.category],
      );
      label = created.rows[0];
    }
  }
  if (label.archived_at !== null) throw new NetWorthError(`"${label.name}" is archived`);
  assertCategory(label.category);

  const { rows } = await sql.query<BalanceRow>(
    `with inserted as (
       insert into net_worth_snapshots (label_id, balance_minor, currency, as_of)
       values ($1, $2, $3, $4)
       returning label_id, balance_minor, currency, as_of
     )
     select inserted.label_id, $5::uuid as user_id, $6::text as label, $7::net_worth_category as category,
            inserted.balance_minor, inserted.currency, inserted.as_of from inserted`,
    [label.id, input.balanceMinor, currency, input.asOf, input.userId, label.name, label.category],
  );
  return toBalance(rows[0]);
}

export async function archiveNetWorthLabel(sql: Sql, userId: string, id: string): Promise<void> {
  const { rows } = await sql.query<{ id: string }>(
    `update net_worth_labels set archived_at = now() where id = $1 and user_id = $2 and archived_at is null returning id`,
    [id, userId],
  );
  if (rows[0]) return;
  const existing = await sql.query<{ id: string }>("select id from net_worth_labels where id = $1 and user_id = $2", [id, userId]);
  if (!existing.rows[0]) throw new NetWorthError("that net-worth label does not exist");
}

export async function createSavingsGoal(sql: Sql, input: { userId: string; name: string; targetMinor: number; linkedLabelId?: string | null; currency?: string }): Promise<SavingsGoal> {
  const name = assertName(input.name, "goal");
  assertMinor(input.targetMinor, "target", 1);
  const currency = assertPhp(input.currency);
  const linkedLabelId = input.linkedLabelId || null;
  if (linkedLabelId) {
    const label = await sql.query<{ id: string }>("select id from net_worth_labels where id = $1 and user_id = $2", [linkedLabelId, input.userId]);
    if (!label.rows[0]) throw new NetWorthError("that linked label does not exist");
  }
  const { rows } = await sql.query<GoalRow>(
    `insert into savings_goals (user_id, name, target_minor, currency, linked_label_id)
     values ($1, $2, $3, $4, $5)
     returning id, user_id, name, target_minor, currency, linked_label_id, null::text as linked_label, archived_at`,
    [input.userId, name, input.targetMinor, currency, linkedLabelId],
  );
  return toGoal(rows[0]);
}

export async function listSavingsGoals(sql: Sql, userId: string, options: { includeArchived?: boolean } = {}): Promise<SavingsGoal[]> {
  const { rows } = await sql.query<GoalRow>(
    `select g.id, g.user_id, g.name, g.target_minor, g.currency, g.linked_label_id,
            l.name as linked_label, g.archived_at
       from savings_goals g left join net_worth_labels l on l.id = g.linked_label_id
      where g.user_id = $1 and ($2::boolean or g.archived_at is null)
      order by g.name`,
    [userId, options.includeArchived ?? false],
  );
  return rows.map(toGoal);
}

export async function archiveSavingsGoal(sql: Sql, userId: string, id: string): Promise<void> {
  const { rows } = await sql.query<{ id: string }>(
    `update savings_goals set archived_at = now() where id = $1 and user_id = $2 and archived_at is null returning id`,
    [id, userId],
  );
  if (rows[0]) return;
  const existing = await sql.query<{ id: string }>("select id from savings_goals where id = $1 and user_id = $2", [id, userId]);
  if (!existing.rows[0]) throw new NetWorthError("that savings goal does not exist");
}

/** A linked label's newest snapshot is the goal balance; unlinked/no-snapshot goals start at zero. */
export async function getSavingsGoalProgress(sql: Sql, userId: string): Promise<SavingsGoalProgress[]> {
  const { rows } = await sql.query<GoalRow>(
    `select g.id, g.user_id, g.name, g.target_minor, g.currency, g.linked_label_id,
            l.name as linked_label, g.archived_at,
            coalesce(snapshot.balance_minor, 0)::bigint as current_minor
       from savings_goals g
       left join net_worth_labels l on l.id = g.linked_label_id
       left join lateral (
         select ns.balance_minor from net_worth_snapshots ns
          where ns.label_id = g.linked_label_id
          order by ns.as_of desc, ns.created_at desc limit 1
       ) snapshot on true
      where g.user_id = $1 and g.archived_at is null
      order by g.name`,
    [userId],
  );
  return rows.map((row) => {
    const goal = toGoal(row);
    const currentMinor = integer(row.current_minor ?? 0, "current balance");
    return { ...goal, currentMinor, progressPercent: Math.floor((currentMinor * 100) / goal.targetMinor) };
  });
}
