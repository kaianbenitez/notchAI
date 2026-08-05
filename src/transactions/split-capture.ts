import { parseAmountToMinor } from "../money";
import { postTransaction, type Sql } from "../ledger/post";
import {
  buildOwedExpense,
  buildSettlement,
  buildSplitExpense,
  splitByWeights,
  splitEqual,
} from "../ledger/split";

export class SplitCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SplitCaptureError";
  }
}
type ShareType = "equal" | "exact" | "pct" | "shares";
type AccountRow = {
  id: string;
  role: string;
  kind: string;
  archived_at: Date | string | null;
};
async function account(sql: Sql, userId: string, id: string, label: string) {
  const { rows } = await sql.query<AccountRow>(
    "select id,role,kind,archived_at from accounts where id=$1 and user_id=$2",
    [id, userId],
  );
  const row = rows[0];
  if (!row) throw new SplitCaptureError(`that ${label} does not exist`);
  if (row.archived_at !== null)
    throw new SplitCaptureError(`that ${label} is archived`);
  return row;
}
async function person(sql: Sql, userId: string, id: string) {
  const { rows } = await sql.query<{
    id: string;
    receivable_account_id: string | null;
  }>("select id,receivable_account_id from people where id=$1 and user_id=$2", [
    id,
    userId,
  ]);
  if (!rows[0]?.receivable_account_id)
    throw new SplitCaptureError("that person does not exist");
  return rows[0];
}
function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new SplitCaptureError("date must be YYYY-MM-DD");
}
function nested(sql: Sql): Sql {
  return {
    async query<T = unknown>(text: string, params?: unknown[]) {
      if (text === "begin") return sql.query<T>("savepoint split_capture_post");
      if (text === "commit")
        return sql.query<T>("release savepoint split_capture_post");
      if (text === "rollback") {
        await sql.query("rollback to savepoint split_capture_post");
        return sql.query<T>("release savepoint split_capture_post");
      }
      return sql.query<T>(text, params);
    },
  };
}
async function verifyGroup(sql: Sql, userId: string, groupId?: string) {
  if (!groupId) return;
  const { rows } = await sql.query<{ id: string }>(
    "select id from groups where id=$1 and user_id=$2 and archived_at is null",
    [groupId, userId],
  );
  if (!rows[0]) throw new SplitCaptureError("that group does not exist");
}

export async function captureSplitExpense(
  sql: Sql,
  input: {
    userId: string;
    occurredAt: string;
    payee: string;
    amount: string;
    categoryId: string;
    accountId: string;
    memo?: string;
    groupId?: string;
    shareType: ShareType;
    participants: { personId: string; weight?: number }[];
  },
): Promise<string> {
  date(input.occurredAt);
  const payee = input.payee.trim();
  if (!payee) throw new SplitCaptureError("payee is required");
  const total = parseAmountToMinor(input.amount);
  if (total <= 0)
    throw new SplitCaptureError("amount must be greater than zero");
  if (!["equal", "exact", "pct", "shares"].includes(input.shareType))
    throw new SplitCaptureError("pick a valid share type");
  if (!input.participants.length)
    throw new SplitCaptureError("pick at least one participant");
  const [paid, category, people] = await Promise.all([
    account(sql, input.userId, input.accountId, "account"),
    account(sql, input.userId, input.categoryId, "category"),
    Promise.all(
      input.participants.map((p) => person(sql, input.userId, p.personId)),
    ),
    verifyGroup(sql, input.userId, input.groupId),
  ]);
  if (!["asset", "liability"].includes(paid.role) || paid.kind === "category" || paid.kind === "receivable" || paid.kind === "payable")
    throw new SplitCaptureError(
      "pick an asset or liability account to pay from",
    );
  if (category.role !== "expense" || category.kind !== "category")
    throw new SplitCaptureError("pick an expense category");
  let values: number[];
  try {
    if (input.shareType === "equal")
      values = splitEqual(total, input.participants.length + 1).slice(1);
    else if (input.shareType === "exact") {
      values = input.participants.map((p) => p.weight ?? NaN);
      if (values.some((v) => !Number.isInteger(v) || v <= 0))
        throw new Error("exact shares must be positive integer centavos");
    } else {
      const weights = input.participants.map((p) => p.weight ?? NaN);
      if (weights.some((v) => !Number.isFinite(v)))
        throw new Error("shares need a weight");
      values = splitByWeights(total, weights);
    }
  } catch (error) {
    throw new SplitCaptureError((error as Error).message);
  }
  if (values.some((v) => v === 0))
    throw new SplitCaptureError("each participant's share must be nonzero");
  const shares = people.map((p, i) => ({
    personAccountId: p.receivable_account_id!,
    shareMinor: values[i],
  }));
  let entries;
  try {
    entries = buildSplitExpense({
      paidFromAccountId: paid.id,
      categoryAccountId: category.id,
      totalMinor: total,
      shares,
    });
  } catch (error) {
    throw new SplitCaptureError((error as Error).message);
  }
  await sql.query("begin");
  try {
    const id = await postTransaction(
      nested(sql),
      {
        userId: input.userId,
        occurredAt: input.occurredAt,
        payee,
        memo: input.memo?.trim() || null,
        source: "manual",
        status: "confirmed",
        groupId: input.groupId ?? null,
      },
      entries,
    );
    for (let i = 0; i < input.participants.length; i++)
      await sql.query(
        "insert into splits (transaction_id,person_id,share_minor,share_type) values ($1,$2,$3,$4)",
        [id, input.participants[i].personId, values[i], input.shareType],
      );
    await sql.query("commit");
    return id;
  } catch (error) {
    await sql.query("rollback");
    throw error;
  }
}

export async function captureOwedExpense(
  sql: Sql,
  input: {
    userId: string;
    occurredAt: string;
    payee: string;
    categoryId: string;
    personId: string;
    yourShareMinor: number;
    memo?: string;
    groupId?: string;
  },
): Promise<string> {
  date(input.occurredAt);
  if (!input.payee.trim()) throw new SplitCaptureError("payee is required");
  if (!Number.isInteger(input.yourShareMinor) || input.yourShareMinor <= 0)
    throw new SplitCaptureError("your share must be a positive integer");
  const [category, p] = await Promise.all([
    account(sql, input.userId, input.categoryId, "category"),
    person(sql, input.userId, input.personId),
    verifyGroup(sql, input.userId, input.groupId),
  ]);
  if (category.role !== "expense" || category.kind !== "category")
    throw new SplitCaptureError("pick an expense category");
  const entries = buildOwedExpense({
    categoryAccountId: category.id,
    personAccountId: p.receivable_account_id!,
    yourShareMinor: input.yourShareMinor,
  });
  await sql.query("begin");
  try {
    const id = await postTransaction(
      nested(sql),
      {
        userId: input.userId,
        occurredAt: input.occurredAt,
        payee: input.payee.trim(),
        memo: input.memo?.trim() || null,
        source: "manual",
        groupId: input.groupId ?? null,
      },
      entries,
    );
    await sql.query(
      "insert into splits (transaction_id,person_id,share_minor,share_type) values ($1,$2,$3,'exact')",
      [id, input.personId, input.yourShareMinor],
    );
    await sql.query("commit");
    return id;
  } catch (error) {
    await sql.query("rollback");
    throw error;
  }
}
export async function captureSettlement(
  sql: Sql,
  input: {
    userId: string;
    occurredAt: string;
    cashAccountId: string;
    personId: string;
    amountMinor: number;
    memo?: string;
  },
): Promise<string> {
  date(input.occurredAt);
  if (!Number.isInteger(input.amountMinor) || input.amountMinor === 0)
    throw new SplitCaptureError("settlement amount must be a nonzero integer");
  const [cash, p] = await Promise.all([
    account(sql, input.userId, input.cashAccountId, "account"),
    person(sql, input.userId, input.personId),
  ]);
  if (cash.role !== "asset" || cash.kind === "category" || cash.kind === "receivable" || cash.kind === "payable")
    throw new SplitCaptureError("pick an asset account to settle into");
  return postTransaction(
    sql,
    {
      userId: input.userId,
      occurredAt: input.occurredAt,
      payee: "Settlement",
      memo: input.memo?.trim() || null,
      source: "manual",
    },
    buildSettlement({
      cashAccountId: cash.id,
      personAccountId: p.receivable_account_id!,
      amountMinor: input.amountMinor,
    }),
  );
}
