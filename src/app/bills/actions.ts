"use server";

import { revalidatePath } from "next/cache";

import { NO_ERROR, type ActionState } from "./action-state";
import { currentUserId } from "../../auth";
import { withDb } from "../../db/client";
import { AmountParseError, parseAmountToMinor } from "../../money";
import { ReminderRuleError, archiveReminderRule, createReminderRule, markReminderRulePaid, updateReminderRule } from "../../reminders/repo";
import { dismissRecurringBillCandidate } from "../../reminders/candidates";

function field(form: FormData, name: string): string { const value = form.get(name); return typeof value === "string" ? value : ""; }
async function run(action: () => Promise<void>): Promise<ActionState> {
  try { await action(); } catch (error) {
    if (error instanceof ReminderRuleError || error instanceof AmountParseError) return { error: error.message };
    console.error("bill action failed", error); return { error: "Something went wrong. Check the server log." };
  }
  revalidatePath("/bills"); return NO_ERROR;
}

export async function createBillAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(() => withDb((sql) => createReminderRule(sql, { userId: currentUserId(), name: field(form, "name"), amountMinor: parseAmountToMinor(field(form, "amount")), accountId: field(form, "accountId"), categoryId: field(form, "categoryId"), recurrencePreset: field(form, "recurrencePreset"), nextDueOn: field(form, "nextDueOn"), autopay: form.get("autopay") === "on" }).then(() => undefined)));
}
export async function updateBillAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(() => withDb((sql) => updateReminderRule(sql, currentUserId(), field(form, "id"), { name: field(form, "name"), amountMinor: parseAmountToMinor(field(form, "amount")), accountId: field(form, "accountId"), categoryId: field(form, "categoryId"), recurrencePreset: field(form, "recurrencePreset"), nextDueOn: field(form, "nextDueOn"), autopay: form.get("autopay") === "on" }).then(() => undefined)));
}
export async function archiveBillAction(_previous: ActionState, form: FormData): Promise<ActionState> { return run(() => withDb((sql) => archiveReminderRule(sql, currentUserId(), field(form, "id")))); }
export async function markBillPaidAction(_previous: ActionState, form: FormData): Promise<ActionState> { return run(() => withDb((sql) => markReminderRulePaid(sql, currentUserId(), field(form, "id")))); }
export async function dismissBillSuggestionAction(_previous: ActionState, form: FormData): Promise<ActionState> { return run(() => withDb((sql) => dismissRecurringBillCandidate(sql, currentUserId(), field(form, "fingerprint")))); }
