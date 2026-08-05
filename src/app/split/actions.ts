"use server";

import { revalidatePath } from "next/cache";

import { currentUserId } from "../../auth";
import { withDb } from "../../db/client";
import { AmountParseError, parseAmountToMinor } from "../../money";
import { SplitCaptureError, captureOwedExpense, captureSplitExpense } from "../../transactions/split-capture";
import { type ActionState, NO_ERROR } from "./action-state";

type Participant = { personId: string; amount?: string };

function field(form: FormData, name: string): string { const value = form.get(name); return typeof value === "string" ? value : ""; }

function participants(form: FormData): Participant[] {
  let value: unknown;
  try {
    value = JSON.parse(field(form, "participants")) as unknown;
  } catch {
    throw new SplitCaptureError("participants are invalid");
  }
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || typeof (item as Participant).personId !== "string" || ("amount" in item && typeof (item as Participant).amount !== "string"))) throw new SplitCaptureError("participants are invalid");
  return value as Participant[];
}

async function run(action: () => Promise<void>): Promise<ActionState> {
  try { await action(); } catch (error) {
    if (error instanceof SplitCaptureError || error instanceof AmountParseError) return { error: error.message };
    console.error("split action failed", error); return { error: "Something went wrong. Check the server log." };
  }
  revalidatePath("/split"); revalidatePath("/friends"); return NO_ERROR;
}

export async function captureSplitExpenseAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(() => withDb(async (sql) => {
    const shareType = field(form, "shareType");
    if (shareType !== "equal" && shareType !== "exact") throw new SplitCaptureError("pick a valid share type");
    parseAmountToMinor(field(form, "amount"));
    const selected = participants(form);
    await captureSplitExpense(sql, { userId: currentUserId(), occurredAt: field(form, "occurredAt"), payee: field(form, "payee"), amount: field(form, "amount"), categoryId: field(form, "categoryId"), accountId: field(form, "accountId"), shareType, participants: selected.map((participant) => ({ personId: participant.personId, ...(shareType === "exact" ? { weight: parseAmountToMinor(participant.amount ?? "") } : {}) })) });
  }));
}

export async function captureOwedExpenseAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(() => withDb((sql) => captureOwedExpense(sql, { userId: currentUserId(), occurredAt: field(form, "occurredAt"), payee: field(form, "payee"), categoryId: field(form, "categoryId"), personId: field(form, "personId"), yourShareMinor: parseAmountToMinor(field(form, "amount")) }).then(() => undefined)));
}
