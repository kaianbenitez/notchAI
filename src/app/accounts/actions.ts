"use server";

import { revalidatePath } from "next/cache";

import { NO_ERROR, type ActionState } from "./action-state";
import {
  AccountError,
  archiveAccount,
  createAccount,
  deleteAccount,
  unarchiveAccount,
  updateAccount,
  setAccountBalance,
  type AccountKind,
  type AccountRole,
} from "../../accounts/repo";
import { currentUserId } from "../../auth";
import { withDb } from "../../db/client";

const ROLES: AccountRole[] = ["asset", "liability", "expense", "income", "equity"];
const KINDS: AccountKind[] = [
  "cash", "bank", "ewallet", "credit_card", "brokerage",
  "receivable", "payable", "category",
];

/**
 * The account-type select submits one value, "role:kind", because the two are
 * not independent — "e-wallet" already tells you it is an asset. Splitting them
 * into separate inputs only creates combinations to validate and reject.
 */
function parseType(value: string): { role: AccountRole; kind: AccountKind } | null {
  const [role, kind] = value.split(":");
  if (!ROLES.includes(role as AccountRole)) return null;
  if (!KINDS.includes(kind as AccountKind)) return null;
  return { role: role as AccountRole, kind: kind as AccountKind };
}

/**
 * Anything the repo or the database refuses is a message worth showing. An
 * unexpected failure is not — it could carry connection details — so it is
 * logged and reported flatly.
 */
async function run(action: () => Promise<void>): Promise<ActionState> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AccountError) return { error: error.message };
    console.error("account action failed", error);
    return { error: "Something went wrong. Check the server log." };
  }
  revalidatePath("/accounts");
  revalidatePath("/categories");
  return NO_ERROR;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function createAccountAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const type = parseType(field(form, "type"));
  if (!type) return { error: "Pick what kind of account this is." };

  const parentId = field(form, "parentId");

  return run(async () => {
    await withDb((sql) =>
      createAccount(sql, {
        userId: currentUserId(),
        name: field(form, "name"),
        role: type.role,
        kind: type.kind,
        currency: field(form, "currency") || "PHP",
        parentId: parentId === "" ? null : parentId,
      }),
    );
  });
}

export async function renameAccountAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = field(form, "id");
  const parentId = field(form, "parentId");

  return run(async () => {
    await withDb((sql) =>
      updateAccount(sql, currentUserId(), id, {
        name: field(form, "name"),
        // The parent select is only rendered for categories; leave it alone when absent.
        ...(form.has("parentId") ? { parentId: parentId === "" ? null : parentId } : {}),
      }),
    );
  });
}

export async function updateAccountBalanceAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = field(form, "id");
  const balance = field(form, "balance");
  const date = field(form, "balanceDate");

  return run(async () => {
    const { parseAmountToMinor } = await import("../../money");
    await withDb((sql) =>
      setAccountBalance(sql, currentUserId(), id, parseAmountToMinor(balance), date)
        .then(() => undefined),
    );
  });
}

export async function archiveAccountAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = field(form, "id");
  return run(async () => {
    await withDb((sql) => archiveAccount(sql, currentUserId(), id));
  });
}

export async function unarchiveAccountAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = field(form, "id");
  return run(async () => {
    await withDb((sql) => unarchiveAccount(sql, currentUserId(), id));
  });
}

export async function deleteAccountAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = field(form, "id");
  return run(async () => {
    await withDb((sql) => deleteAccount(sql, currentUserId(), id));
  });
}
