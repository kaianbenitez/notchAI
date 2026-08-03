"use server";

import { revalidatePath } from "next/cache";

import { currentUserId } from "../../auth";
import { withDb } from "../../db/client";
import { AmountParseError } from "../../money";
import { CaptureError, captureTransaction } from "../../transactions/capture";
import type { ActionState } from "./action-state";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function captureTransactionAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const transactionId = await withDb((sql) => captureTransaction(sql, {
      userId: currentUserId(),
      direction: field(form, "direction") === "in" ? "in" : "out",
      occurredAt: field(form, "occurredAt"),
      payee: field(form, "payee"),
      amount: field(form, "amount"),
      categoryId: field(form, "categoryId"),
      accountId: field(form, "accountId"),
      memo: field(form, "memo"),
      clientId: field(form, "clientId"),
    }));
    revalidatePath("/log");
    return { error: null, transactionId };
  } catch (error) {
    if (error instanceof CaptureError || error instanceof AmountParseError) {
      return { error: error.message, transactionId: null };
    }
    throw error;
  }
}
