import { archiveAccount } from "../accounts/repo";
import type { Sql } from "../ledger/post";

export interface Person {
  id: string;
  userId: string;
  name: string;
  contact: string | null;
  linkedUserId: string | null;
  receivableAccountId: string;
}
export interface PersonWithBalance extends Person {
  balanceMinor: number;
}
export interface FriendActivity {
  transactionId: string;
  occurredAt: string;
  payee: string | null;
  memo: string | null;
  personId: string;
  personName: string;
  groupId: string | null;
  groupName: string | null;
  amountMinor: number;
  shareType: "equal" | "exact" | "pct" | "shares" | null;
}
export class PersonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonError";
  }
}
type Row = {
  id: string;
  user_id: string;
  name: string;
  contact: string | null;
  linked_user_id: string | null;
  receivable_account_id: string;
  balance_minor?: string | number;
};
const columns =
  "p.id, p.user_id, p.name, p.contact, p.linked_user_id, p.receivable_account_id";
function person(row: Row): Person {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    contact: row.contact,
    linkedUserId: row.linked_user_id,
    receivableAccountId: row.receivable_account_id,
  };
}
function withBalance(row: Row): PersonWithBalance {
  return { ...person(row), balanceMinor: Number(row.balance_minor ?? 0) };
}
function cleanName(name: string): string {
  const value = name.trim().replace(/\s+/g, " ");
  if (!value) throw new PersonError("a person needs a name");
  if (value.length > 80)
    throw new PersonError(
      `name is too long (${value.length} characters, max 80)`,
    );
  return value;
}
async function nameFree(sql: Sql, userId: string, name: string): Promise<void> {
  const { rows } = await sql.query<{ id: string }>(
    `select p.id from people p join accounts a on a.id = p.receivable_account_id where p.user_id = $1 and lower(p.name) = lower($2) and a.archived_at is null limit 1`,
    [userId, name],
  );
  if (rows[0])
    throw new PersonError(`you already have a person called "${name}"`);
}
export async function createPerson(
  sql: Sql,
  input: { userId: string; name: string; contact?: string },
): Promise<Person> {
  const name = cleanName(input.name);
  await nameFree(sql, input.userId, name);
  await sql.query("begin");
  try {
    const created = await sql.query<Row>(
      "insert into people (user_id, name, contact) values ($1, $2, $3) returning id, user_id, name, contact, linked_user_id, receivable_account_id",
      [input.userId, name, input.contact?.trim() || null],
    );
    const p = created.rows[0];
    const account = await sql.query<{ id: string }>(
      "insert into accounts (user_id, name, role, kind, person_id) values ($1, $2, 'asset', 'receivable', $3) returning id",
      [input.userId, `${name} (owed)`, p.id],
    );
    const updated = await sql.query<Row>(
      "update people set receivable_account_id = $2 where id = $1 returning id, user_id, name, contact, linked_user_id, receivable_account_id",
      [p.id, account.rows[0].id],
    );
    await sql.query("commit");
    return person(updated.rows[0]);
  } catch (error) {
    await sql.query("rollback");
    throw error;
  }
}
export async function listPeople(
  sql: Sql,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<PersonWithBalance[]> {
  const { rows } = await sql.query<Row>(
    `select ${columns}, b.balance_minor from people p join accounts a on a.id=p.receivable_account_id join account_balances b on b.account_id=a.id where p.user_id=$1 and ($2::boolean or a.archived_at is null) order by p.name`,
    [userId, options.includeArchived ?? false],
  );
  return rows.map(withBalance);
}

type FriendActivityRow = {
  transaction_id: string;
  occurred_at: string;
  payee: string | null;
  memo: string | null;
  person_id: string;
  person_name: string;
  group_id: string | null;
  group_name: string | null;
  amount_minor: string | number;
  share_type: FriendActivity["shareType"];
};

/** Recent ledger entries against each friend's receivable account. */
export async function listRecentFriendActivity(
  sql: Sql,
  userId: string,
  options: { limit?: number; personId?: string } = {},
): Promise<FriendActivity[]> {
  const { rows } = await sql.query<FriendActivityRow>(
    `select t.id as transaction_id,
            t.occurred_at::text as occurred_at,
            t.payee,
            t.memo,
            p.id as person_id,
            p.name as person_name,
            g.id as group_id,
            g.name as group_name,
            e.amount_minor,
            s.share_type
       from entries e
       join accounts a on a.id = e.account_id
       join people p on p.id = a.person_id
       join transactions t on t.id = e.transaction_id
       left join groups g on g.id = t.group_id
       left join splits s on s.transaction_id = t.id and s.person_id = p.id
      where a.kind = 'receivable'
        and p.user_id = $1
        and t.user_id = $1
        and t.status <> 'duplicate_merged'
        and ($2::uuid is null or p.id = $2)
      order by t.occurred_at desc, t.created_at desc
      limit $3`,
    [userId, options.personId ?? null, options.limit ?? 20],
  );
  return rows.map((row) => ({
    transactionId: row.transaction_id,
    occurredAt: row.occurred_at,
    payee: row.payee,
    memo: row.memo,
    personId: row.person_id,
    personName: row.person_name,
    groupId: row.group_id,
    groupName: row.group_name,
    amountMinor: Number(row.amount_minor),
    shareType: row.share_type,
  }));
}
export async function getPerson(
  sql: Sql,
  userId: string,
  id: string,
): Promise<PersonWithBalance | null> {
  const { rows } = await sql.query<Row>(
    `select ${columns}, b.balance_minor from people p join account_balances b on b.account_id=p.receivable_account_id where p.id=$1 and p.user_id=$2`,
    [id, userId],
  );
  return rows[0] ? withBalance(rows[0]) : null;
}
export async function archivePerson(
  sql: Sql,
  userId: string,
  id: string,
): Promise<Person> {
  const p = await getPerson(sql, userId, id);
  if (!p) throw new PersonError("that person does not exist");
  if (p.balanceMinor !== 0)
    throw new PersonError("settle this person's balance before archiving them");
  try {
    await archiveAccount(sql, userId, p.receivableAccountId);
  } catch (error) {
    throw new PersonError((error as Error).message);
  }
  return p;
}
