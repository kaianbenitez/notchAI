"use server";

import { revalidatePath } from "next/cache";

import { currentUserId } from "../../auth";
import { withDb } from "../../db/client";
import { AmountParseError, parseAmountToMinor } from "../../money";
import { PersonError, archivePerson, createPerson } from "../../people/repo";
import { SplitCaptureError, captureSettlement } from "../../transactions/split-capture";
import { type ActionState, NO_ERROR } from "./action-state";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function manilaToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

async function run(action: () => Promise<void>): Promise<ActionState> {
  try {
    await action();
  } catch (error) {
    if (error instanceof PersonError || error instanceof SplitCaptureError || error instanceof AmountParseError) {
      return { error: error.message };
    }
    console.error("friend action failed", error);
    return { error: "Something went wrong. Check the server log." };
  }
  revalidatePath("/friends");
  return NO_ERROR;
}

export async function createPersonAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(() => withDb((sql) => createPerson(sql, {
    userId: currentUserId(), name: field(form, "name"), contact: field(form, "contact"),
  }).then(() => undefined)));
}

export async function archivePersonAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(() => withDb((sql) => archivePerson(sql, currentUserId(), field(form, "id")).then(() => undefined)));
}

export async function settleUpAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(() => withDb(async (sql) => {
    const direction = field(form, "direction");
    if (direction !== "they_paid_you" && direction !== "you_paid_them") {
      throw new SplitCaptureError("settlement direction is invalid");
    }
    let amountMinor = parseAmountToMinor(field(form, "amount"));
    if (direction === "you_paid_them") amountMinor = -amountMinor;
    await captureSettlement(sql, {
      userId: currentUserId(), occurredAt: manilaToday(), cashAccountId: field(form, "accountId"),
      personId: field(form, "personId"), amountMinor,
    });
  }));
}
