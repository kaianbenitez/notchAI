"use server";

import { revalidatePath } from "next/cache";
import { currentUserId } from "../../auth";
import { withDb } from "../../db/client";
import { dismissGmailReviewItem, resolveGmailReviewItem } from "../../ingest/gmail/repo";

function field(form: FormData, name: string) { const value = form.get(name); return typeof value === "string" ? value : ""; }
export async function resolveGmailItemAction(form: FormData) { await withDb((sql) => resolveGmailReviewItem(sql, currentUserId(), field(form, "id"), field(form, "accountId"), field(form, "categoryId"))); revalidatePath("/review"); revalidatePath("/month"); }
export async function dismissGmailItemAction(form: FormData) { await withDb((sql) => dismissGmailReviewItem(sql, currentUserId(), field(form, "id"))); revalidatePath("/review"); }
