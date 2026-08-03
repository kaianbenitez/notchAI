"use server";

import { revalidatePath } from "next/cache";

import { NO_ERROR, type ActionState } from "./action-state";
import { BudgetError, archiveBudget, createBudget, unarchiveBudget, updateBudget } from "../../budgets/repo";
import { parseAmountToMinor, AmountParseError } from "../../money";
import { currentUserId } from "../../auth";
import { withDb } from "../../db/client";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

async function run(action: () => Promise<void>): Promise<ActionState> {
  try {
    await action();
  } catch (error) {
    if (error instanceof BudgetError || error instanceof AmountParseError) return { error: error.message };
    console.error("budget action failed", error);
    return { error: "Something went wrong. Check the server log." };
  }
  revalidatePath("/budgets");
  revalidatePath("/month");
  return NO_ERROR;
}

export async function createBudgetAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    await withDb((sql) => createBudget(sql, {
      userId: currentUserId(), accountId: field(form, "accountId"),
      amountMinor: parseAmountToMinor(field(form, "amount")),
      rolloverEnabled: form.get("rolloverEnabled") === "on", startsOn: field(form, "startsOn"),
    }));
  });
}

export async function updateBudgetAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    await withDb((sql) => updateBudget(sql, currentUserId(), field(form, "id"), {
      amountMinor: parseAmountToMinor(field(form, "amount")),
      rolloverEnabled: form.get("rolloverEnabled") === "on",
    }));
  });
}

export async function archiveBudgetAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => { await withDb((sql) => archiveBudget(sql, currentUserId(), field(form, "id"))); });
}

export async function unarchiveBudgetAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => { await withDb((sql) => unarchiveBudget(sql, currentUserId(), field(form, "id"))); });
}
