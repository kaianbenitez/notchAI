"use server";

import { revalidatePath } from "next/cache";

import { currentUserId } from "../../auth";
import { withDb } from "../../db/client";
import { AmountParseError, parseAmountToMinor } from "../../money";
import { NetWorthError, archiveNetWorthLabel, archiveSavingsGoal, createSavingsGoal, recordNetWorthSnapshot } from "../../net-worth/repo";
import { NO_ERROR, type ActionState } from "./action-state";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

async function run(action: () => Promise<void>): Promise<ActionState> {
  try {
    await action();
  } catch (error) {
    if (error instanceof NetWorthError || error instanceof AmountParseError) return { error: error.message };
    console.error("net-worth action failed", error);
    return { error: "Something went wrong. Check the server log." };
  }
  revalidatePath("/net-worth");
  return NO_ERROR;
}

export async function recordNetWorthSnapshotAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const existingLabelId = field(form, "labelId");
    await withDb((sql) => recordNetWorthSnapshot(sql, {
      userId: currentUserId(),
      labelId: existingLabelId || undefined,
      labelName: existingLabelId ? undefined : field(form, "labelName"),
      category: existingLabelId ? undefined : field(form, "category") as "cash" | "investment" | "property" | "vehicle" | "other",
      balanceMinor: parseAmountToMinor(field(form, "balance")),
      asOf: field(form, "asOf"),
    }).then(() => undefined));
  });
}

export async function archiveNetWorthLabelAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(() => withDb((sql) => archiveNetWorthLabel(sql, currentUserId(), field(form, "id"))));
}

export async function createSavingsGoalAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(() => withDb((sql) => createSavingsGoal(sql, {
    userId: currentUserId(),
    name: field(form, "name"),
    targetMinor: parseAmountToMinor(field(form, "target")),
    linkedLabelId: field(form, "linkedLabelId") || null,
  }).then(() => undefined)));
}

export async function archiveSavingsGoalAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(() => withDb((sql) => archiveSavingsGoal(sql, currentUserId(), field(form, "id"))));
}
