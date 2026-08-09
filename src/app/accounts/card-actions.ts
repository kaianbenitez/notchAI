"use server";

import { revalidatePath } from "next/cache";

import { currentUserId } from "../../auth";
import { withDb } from "../../db/client";
import { CreditCardStatementError, createCreditCardStatement, payCreditCardStatement, saveCreditCardCutoff } from "../../credit-cards/repo";
import { AmountParseError } from "../../money";
import type { ActionState } from "./action-state";

function field(form: FormData, name: string): string { const value = form.get(name); return typeof value === "string" ? value : ""; }
async function run(accountId: string, action: () => Promise<void>): Promise<ActionState> {
  try { await action(); } catch (error) {
    if (error instanceof CreditCardStatementError || error instanceof AmountParseError) return { error: error.message };
    console.error("credit-card action failed", error); return { error: "Something went wrong. Check the server log." };
  }
  revalidatePath(`/accounts/${accountId}`); revalidatePath("/accounts"); return { error: null };
}

export async function saveCardCutoffAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const accountId = field(form, "accountId");
  return run(accountId, () => withDb((sql) => saveCreditCardCutoff(sql, currentUserId(), accountId, Number(field(form, "cutoffDay")))));
}

export async function createCardStatementAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const accountId = field(form, "accountId");
  return run(accountId, () => withDb((sql) => createCreditCardStatement(sql, { userId: currentUserId(), accountId, today: field(form, "today"), amount: field(form, "amount"), dueOn: field(form, "dueOn") }).then(() => undefined)));
}

export async function payCardStatementAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const accountId = field(form, "accountId");
  return run(accountId, () => withDb((sql) => payCreditCardStatement(sql, { userId: currentUserId(), statementId: field(form, "statementId"), fundingAccountId: field(form, "fundingAccountId"), paidOn: field(form, "paidOn") }).then(() => undefined)));
}
