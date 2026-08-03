"use server";

import { listAccounts } from "../../accounts/repo";
import { buildCaptureDraft, callGeminiForCapture } from "../../capture/ai-parse";
import { currentUserId } from "../../auth";
import { withDb } from "../../db/client";
import type { ParseState } from "./ai-action-state";

function todayInManila(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function parseCaptureDraftAction(_previous: ParseState, form: FormData): Promise<ParseState> {
  try {
    const photo = form.get("photo");
    const text = form.get("text");
    const hasPhoto = photo instanceof File && photo.size > 0;
    const description = typeof text === "string" ? text.trim() : "";
    if (!hasPhoto && !description) return { error: "Add a receipt photo or a short description first.", draft: null };

    const raw = await callGeminiForCapture({
      text: description || undefined,
      ...(hasPhoto ? { imageBase64: Buffer.from(await photo.arrayBuffer()).toString("base64"), imageMimeType: photo.type || "image/jpeg" } : {}),
    });
    const categories = await withDb((sql) => listAccounts(sql, currentUserId(), { roles: ["expense"] }));
    return {
      error: null,
      draft: buildCaptureDraft(raw, categories, todayInManila()),
    };
  } catch (error) {
    console.error("AI capture parse failed", error);
    return { error: error instanceof Error ? error.message : "Could not read that capture. Try again." , draft: null };
  }
}
