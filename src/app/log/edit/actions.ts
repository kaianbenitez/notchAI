"use server";

import { revalidatePath } from "next/cache";

import { currentUserId } from "../../../auth";
import { withDb } from "../../../db/client";
import { EditError, updateTransaction } from "../../../transactions/edit";
import type { EditActionState } from "./action-state";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function updateTransactionAction(
  _previous: EditActionState,
  form: FormData,
): Promise<EditActionState> {
  const transactionId = field(form, "transactionId");
  try {
    await withDb((sql) => updateTransaction(sql, currentUserId(), transactionId, {
      occurredAt: field(form, "occurredAt"),
      payee: field(form, "payee"),
      categoryId: field(form, "categoryId"),
      accountId: field(form, "accountId"),
      memo: field(form, "memo"),
    }));
    revalidatePath("/month");
    revalidatePath("/log");
    return { error: null, ok: true };
  } catch (error) {
    if (error instanceof EditError) {
      return { error: error.message, ok: false };
    }
    throw error;
  }
}
