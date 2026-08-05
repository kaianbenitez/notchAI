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
