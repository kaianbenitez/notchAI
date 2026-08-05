import type { PersonWithBalance } from "../people/repo";
import type { Sql } from "../ledger/post";
export interface Group {
  id: string;
  userId: string;
  name: string;
  currency: string;
  simplifyDebtsEnabled: boolean;
  archivedAt: Date | null;
}
export class GroupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroupError";
  }
}
type Row = {
  id: string;
  user_id: string;
  name: string;
  currency: string;
  simplify_debts_enabled: boolean;
  archived_at: Date | string | null;
};

type PersonWithBalanceRow = {
  id: string;
  user_id: string;
  name: string;
  contact: string | null;
  linked_user_id: string | null;
  receivable_account_id: string;
  balance_minor: string | number;
};
function group(r: Row): Group {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    currency: r.currency.trim(),
    simplifyDebtsEnabled: r.simplify_debts_enabled,
    archivedAt: r.archived_at ? new Date(r.archived_at) : null,
  };
}
export async function createGroup(
  sql: Sql,
  input: {
    userId: string;
    name: string;
    currency?: string;
    simplifyDebtsEnabled?: boolean;
  },
): Promise<Group> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new GroupError("a group needs a name");
  const currency = (input.currency ?? "PHP").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    throw new GroupError(`"${currency}" is not a three-letter currency code`);
  const { rows } = await sql.query<Row>(
    "insert into groups (user_id,name,currency,simplify_debts_enabled) values ($1,$2,$3,$4) returning id,user_id,name,currency,simplify_debts_enabled,archived_at",
    [input.userId, name, currency, input.simplifyDebtsEnabled ?? false],
  );
  return group(rows[0]);
}
async function owned(
  sql: Sql,
  userId: string,
  groupId: string,
  personId: string,
) {
  const [g, p] = await Promise.all([
    sql.query<{ id: string }>(
      "select id from groups where id=$1 and user_id=$2 and archived_at is null",
      [groupId, userId],
    ),
    sql.query<{ id: string }>(
      "select id from people where id=$1 and user_id=$2",
      [personId, userId],
    ),
  ]);
  if (!g.rows[0]) throw new GroupError("that group does not exist");
  if (!p.rows[0]) throw new GroupError("that person does not exist");
}
export async function addGroupMember(
  sql: Sql,
  userId: string,
  groupId: string,
  personId: string,
  defaultShareWeight = 1,
): Promise<void> {
  await owned(sql, userId, groupId, personId);
  if (!Number.isFinite(defaultShareWeight) || defaultShareWeight <= 0)
    throw new GroupError("default share weight must be positive");
  const exists = await sql.query<{ group_id: string }>(
    "select group_id from group_members where group_id=$1 and person_id=$2",
    [groupId, personId],
  );
  if (exists.rows[0])
    throw new GroupError("that person is already in this group");
  await sql.query(
    "insert into group_members (group_id,person_id,default_share_weight) values ($1,$2,$3)",
    [groupId, personId, defaultShareWeight],
  );
}
export async function listGroupMembers(
  sql: Sql,
  userId: string,
  groupId: string,
): Promise<PersonWithBalance[]> {
  const check = await sql.query<{ id: string }>(
    "select id from groups where id=$1 and user_id=$2",
    [groupId, userId],
  );
  if (!check.rows[0]) throw new GroupError("that group does not exist");
  const { rows } = await sql.query<PersonWithBalanceRow>(
    `select p.id,p.user_id,p.name,p.contact,p.linked_user_id,p.receivable_account_id,b.balance_minor from group_members gm join people p on p.id=gm.person_id join account_balances b on b.account_id=p.receivable_account_id where gm.group_id=$1 order by p.name`,
    [groupId],
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    contact: row.contact,
    linkedUserId: row.linked_user_id,
    receivableAccountId: row.receivable_account_id,
    balanceMinor: Number(row.balance_minor),
  }));
}
export async function listGroups(
  sql: Sql,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<Group[]> {
  const { rows } = await sql.query<Row>(
    "select id,user_id,name,currency,simplify_debts_enabled,archived_at from groups where user_id=$1 and ($2::boolean or archived_at is null) order by name",
    [userId, options.includeArchived ?? false],
  );
  return rows.map(group);
}

export async function archiveGroup(
  sql: Sql,
  userId: string,
  id: string,
): Promise<Group> {
  const { rows } = await sql.query<Row>(
    `update groups set archived_at = now()
      where id = $1 and user_id = $2 and archived_at is null
      returning id, user_id, name, currency, simplify_debts_enabled, archived_at`,
    [id, userId],
  );
  if (!rows[0]) throw new GroupError("that group does not exist");
  return group(rows[0]);
}
