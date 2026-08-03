/**
 * Accounts and categories.
 *
 * There is one table. A wallet, a credit card, a friend's receivable and the
 * "Dining" budget category are all rows in `accounts` — that is what lets a
 * split, a debt and a budget read from the same ledger (PLAN.md §3).
 *
 * The database enforces the invariants that must never be violated; this layer
 * adds the ones that need a useful error message, plus the few it cannot
 * express in a CHECK (a category's parent must be a category of the same role).
 */

import type { Sql } from "../ledger/post";

export type AccountRole = "asset" | "liability" | "expense" | "income" | "equity";

export type AccountKind =
  | "cash" | "bank" | "ewallet" | "credit_card" | "brokerage"
  | "receivable" | "payable" | "category";

export interface Account {
  id: string;
  userId: string;
  name: string;
  role: AccountRole;
  kind: AccountKind;
  currency: string;
  parentId: string | null;
  personId: string | null;
  archivedAt: Date | null;
}

/** An account with its balance from the `account_balances` view. */
export interface AccountWithBalance extends Account {
  /** Signed ledger balance in centavos. */
  balanceMinor: number;
  /** Sign-flipped for liabilities and income, so "you owe ₱1,000" reads +100000. */
  displayBalanceMinor: number;
}

export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountError";
  }
}

/**
 * Which kinds make sense for each role. Stricter than the CHECKs in
 * db/schema.sql, which only rule out the combinations that would corrupt a
 * balance; these also rule out the ones that are merely nonsense.
 *
 * `equity` exists for opening balances — the counter-entry when you tell the
 * app a wallet already had ₱5,000 in it. There is no dedicated kind in the
 * enum, so it borrows 'cash'.
 */
const KINDS_BY_ROLE: Record<AccountRole, AccountKind[]> = {
  asset: ["cash", "bank", "ewallet", "brokerage", "receivable"],
  liability: ["credit_card", "payable"],
  expense: ["category"],
  income: ["category"],
  equity: ["cash"],
};

const SELECT_COLUMNS = `
  a.id, a.user_id, a.name, a.role, a.kind, a.currency,
  a.parent_id, a.person_id, a.archived_at
`;

interface AccountRow {
  id: string;
  user_id: string;
  name: string;
  role: AccountRole;
  kind: AccountKind;
  currency: string;
  parent_id: string | null;
  person_id: string | null;
  archived_at: Date | string | null;
  balance_minor?: string | number;
  display_balance_minor?: string | number;
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    role: row.role,
    kind: row.kind,
    currency: row.currency.trim(), // char(3) comes back padded
    parentId: row.parent_id,
    personId: row.person_id,
    archivedAt: row.archived_at === null ? null : new Date(row.archived_at),
  };
}

function toAccountWithBalance(row: AccountRow): AccountWithBalance {
  return {
    ...toAccount(row),
    // bigint arrives as a string from pg; centavos stay well inside a safe integer.
    balanceMinor: Number(row.balance_minor ?? 0),
    displayBalanceMinor: Number(row.display_balance_minor ?? 0),
  };
}

function cleanName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed === "") throw new AccountError("an account needs a name");
  if (trimmed.length > 80) {
    throw new AccountError(`name is too long (${trimmed.length} characters, max 80)`);
  }
  return trimmed;
}

function assertRoleKind(role: AccountRole, kind: AccountKind): void {
  const allowed = KINDS_BY_ROLE[role];
  if (!allowed) throw new AccountError(`unknown role "${role}"`);
  if (!allowed.includes(kind)) {
    throw new AccountError(
      `a ${role} account cannot be of kind "${kind}" — try one of: ${allowed.join(", ")}`,
    );
  }
}

/**
 * Two live accounts with the same name and role would silently split a budget
 * in half — you would file half your groceries under each "Groceries" and
 * neither number would be right. Archived names are free to reuse.
 */
async function assertNameFree(
  sql: Sql,
  userId: string,
  role: AccountRole,
  name: string,
  exceptId?: string,
): Promise<void> {
  const { rows } = await sql.query<{ id: string }>(
    `select id from accounts
      where user_id = $1 and role = $2 and lower(name) = lower($3)
        and archived_at is null and ($4::uuid is null or id <> $4)
      limit 1`,
    [userId, role, name, exceptId ?? null],
  );
  if (rows.length > 0) {
    throw new AccountError(`you already have a ${role} account called "${name}"`);
  }
}

/**
 * A parent must belong to the same user and the same role. Categories nest
 * (Food > Groceries) but "Food" must not end up parenting a bank account, and
 * an income category must not hang off an expense one — the month view sums by
 * walking the tree and would double-count across roles.
 */
async function assertParentValid(
  sql: Sql,
  userId: string,
  role: AccountRole,
  parentId: string,
  childId?: string,
): Promise<void> {
  if (parentId === childId) {
    throw new AccountError("an account cannot be its own parent");
  }

  const { rows } = await sql.query<AccountRow>(
    `select ${SELECT_COLUMNS} from accounts a where a.id = $1 and a.user_id = $2`,
    [parentId, userId],
  );
  const parent = rows[0];
  if (!parent) throw new AccountError("that parent account does not exist");
  if (parent.role !== role) {
    throw new AccountError(
      `parent "${parent.name}" is a ${parent.role} account; a ${role} account cannot sit under it`,
    );
  }
  if (parent.archived_at !== null) {
    throw new AccountError(`parent "${parent.name}" is archived`);
  }

  // Walk up from the proposed parent. If we meet the child, this would make a
  // cycle and every tree walk in the app would hang.
  if (childId) {
    let cursor: string | null = parent.parent_id;
    const seen = new Set<string>([parentId]);
    while (cursor) {
      if (cursor === childId) {
        throw new AccountError("that would put the account underneath itself");
      }
      if (seen.has(cursor)) break; // pre-existing cycle; not this call's problem
      seen.add(cursor);
      const step: { rows: { parent_id: string | null }[] } = await sql.query<{
        parent_id: string | null;
      }>(`select parent_id from accounts where id = $1`, [cursor]);
      cursor = step.rows[0]?.parent_id ?? null;
    }
  }
}

export interface CreateAccountInput {
  userId: string;
  name: string;
  role: AccountRole;
  kind: AccountKind;
  currency?: string;
  parentId?: string | null;
  personId?: string | null;
}

export async function createAccount(
  sql: Sql,
  input: CreateAccountInput,
): Promise<Account> {
  const name = cleanName(input.name);
  assertRoleKind(input.role, input.kind);

  const currency = (input.currency ?? "PHP").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AccountError(`"${currency}" is not a three-letter currency code`);
  }

  await assertNameFree(sql, input.userId, input.role, name);
  if (input.parentId) {
    await assertParentValid(sql, input.userId, input.role, input.parentId);
  }

  const { rows } = await sql.query<AccountRow>(
    `insert into accounts (user_id, name, role, kind, currency, parent_id, person_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, user_id, name, role, kind, currency, parent_id, person_id, archived_at`,
    [
      input.userId,
      name,
      input.role,
      input.kind,
      currency,
      input.parentId ?? null,
      input.personId ?? null,
    ],
  );
  return toAccount(rows[0]);
}

/** Convenience wrapper: a category is an account, and always kind 'category'. */
export function createCategory(
  sql: Sql,
  input: {
    userId: string;
    name: string;
    role?: "expense" | "income";
    parentId?: string | null;
  },
): Promise<Account> {
  return createAccount(sql, {
    userId: input.userId,
    name: input.name,
    role: input.role ?? "expense",
    kind: "category",
    parentId: input.parentId ?? null,
  });
}

export interface ListAccountsFilter {
  roles?: AccountRole[];
  kinds?: AccountKind[];
  includeArchived?: boolean;
}

/**
 * Accounts with balances, ordered as a tree: each parent immediately followed
 * by its children, siblings alphabetical.
 */
export async function listAccounts(
  sql: Sql,
  userId: string,
  filter: ListAccountsFilter = {},
): Promise<AccountWithBalance[]> {
  const { rows } = await sql.query<AccountRow>(
    `select ${SELECT_COLUMNS},
            b.balance_minor, b.display_balance_minor
       from accounts a
       join account_balances b on b.account_id = a.id
      where a.user_id = $1
        and ($2::boolean or a.archived_at is null)
        and ($3::text[] is null or a.role::text = any($3))
        and ($4::text[] is null or a.kind::text = any($4))
      order by a.name`,
    [
      userId,
      filter.includeArchived ?? false,
      filter.roles ?? null,
      filter.kinds ?? null,
    ],
  );

  return sortIntoTree(rows.map(toAccountWithBalance));
}

/**
 * Parent-then-children ordering. Rows whose parent was filtered out are treated
 * as roots so nothing silently disappears from a list.
 */
function sortIntoTree<T extends { id: string; parentId: string | null; name: string }>(
  accounts: T[],
): T[] {
  const present = new Set(accounts.map((a) => a.id));
  const childrenOf = new Map<string | null, T[]>();

  for (const account of accounts) {
    const key =
      account.parentId && present.has(account.parentId) ? account.parentId : null;
    const siblings = childrenOf.get(key) ?? [];
    siblings.push(account);
    childrenOf.set(key, siblings);
  }

  const ordered: T[] = [];
  const walk = (parentId: string | null) => {
    const siblings = (childrenOf.get(parentId) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const account of siblings) {
      ordered.push(account);
      walk(account.id);
    }
  };
  walk(null);
  return ordered;
}

export async function getAccount(
  sql: Sql,
  userId: string,
  id: string,
): Promise<AccountWithBalance | null> {
  const { rows } = await sql.query<AccountRow>(
    `select ${SELECT_COLUMNS},
            b.balance_minor, b.display_balance_minor
       from accounts a
       join account_balances b on b.account_id = a.id
      where a.id = $1 and a.user_id = $2`,
    [id, userId],
  );
  return rows[0] ? toAccountWithBalance(rows[0]) : null;
}

export interface UpdateAccountInput {
  name?: string;
  parentId?: string | null;
}

/**
 * Rename or re-parent. Role and kind are deliberately not editable: entries are
 * already filed against this account, and flipping an expense category to an
 * asset would silently rewrite history in every budget and balance that reads
 * it. Archive it and make a new one instead.
 */
export async function updateAccount(
  sql: Sql,
  userId: string,
  id: string,
  changes: UpdateAccountInput,
): Promise<Account> {
  const existing = await getAccount(sql, userId, id);
  if (!existing) throw new AccountError("that account does not exist");

  const name = changes.name === undefined ? existing.name : cleanName(changes.name);
  if (name.toLowerCase() !== existing.name.toLowerCase()) {
    await assertNameFree(sql, userId, existing.role, name, id);
  }

  const parentId =
    changes.parentId === undefined ? existing.parentId : changes.parentId;
  if (parentId && parentId !== existing.parentId) {
    await assertParentValid(sql, userId, existing.role, parentId, id);
  }

  const { rows } = await sql.query<AccountRow>(
    `update accounts set name = $3, parent_id = $4
      where id = $1 and user_id = $2
      returning id, user_id, name, role, kind, currency, parent_id, person_id, archived_at`,
    [id, userId, name, parentId],
  );
  return toAccount(rows[0]);
}

/**
 * Archiving hides an account without touching its entries, so past months keep
 * reporting the same numbers. This is the normal way to retire a category.
 */
export async function archiveAccount(
  sql: Sql,
  userId: string,
  id: string,
): Promise<Account> {
  const existing = await getAccount(sql, userId, id);
  if (!existing) throw new AccountError("that account does not exist");

  const { rows: children } = await sql.query<{ count: string }>(
    `select count(*) as count from accounts
      where parent_id = $1 and archived_at is null`,
    [id],
  );
  if (Number(children[0].count) > 0) {
    throw new AccountError(
      `"${existing.name}" still has sub-accounts — archive those first`,
    );
  }

  const { rows } = await sql.query<AccountRow>(
    `update accounts set archived_at = now()
      where id = $1 and user_id = $2 and archived_at is null
      returning id, user_id, name, role, kind, currency, parent_id, person_id, archived_at`,
    [id, userId],
  );
  return rows[0] ? toAccount(rows[0]) : { ...existing };
}

export async function unarchiveAccount(
  sql: Sql,
  userId: string,
  id: string,
): Promise<Account> {
  const { rows } = await sql.query<AccountRow>(
    `update accounts set archived_at = null
      where id = $1 and user_id = $2
      returning id, user_id, name, role, kind, currency, parent_id, person_id, archived_at`,
    [id, userId],
  );
  if (!rows[0]) throw new AccountError("that account does not exist");
  return toAccount(rows[0]);
}

/**
 * Hard delete, allowed only while an account has never been used. Anything with
 * entries against it must be archived — deleting it would either orphan history
 * or unbalance the transactions it took part in, and the ledger's whole promise
 * is that this cannot happen.
 */
export async function deleteAccount(
  sql: Sql,
  userId: string,
  id: string,
): Promise<void> {
  const existing = await getAccount(sql, userId, id);
  if (!existing) throw new AccountError("that account does not exist");

  const { rows } = await sql.query<{ count: string }>(
    `select count(*) as count from entries where account_id = $1`,
    [id],
  );
  if (Number(rows[0].count) > 0) {
    throw new AccountError(
      `"${existing.name}" has ${rows[0].count} transaction entries and cannot be deleted — archive it instead`,
    );
  }

  const { rows: children } = await sql.query<{ count: string }>(
    `select count(*) as count from accounts where parent_id = $1`,
    [id],
  );
  if (Number(children[0].count) > 0) {
    throw new AccountError(`"${existing.name}" still has sub-accounts`);
  }

  await sql.query(`delete from accounts where id = $1 and user_id = $2`, [id, userId]);
}
