"use server";

import { revalidatePath } from "next/cache";

import { currentUserId } from "../../auth";
import { withDb } from "../../db/client";
import { GroupError, addGroupMember, archiveGroup, createGroup } from "../../groups/repo";
import { type ActionState, NO_ERROR } from "./action-state";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

async function run(action: () => Promise<void>): Promise<ActionState> {
  try {
    await action();
  } catch (error) {
    if (error instanceof GroupError) return { error: error.message };
    console.error("group action failed", error);
    return { error: "Something went wrong. Check the server log." };
  }
  revalidatePath("/groups");
  revalidatePath("/split");
  return NO_ERROR;
}

export async function createGroupAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(() => withDb((sql) => createGroup(sql, { userId: currentUserId(), name: field(form, "name") }).then(() => undefined)));
}

export async function addGroupMemberAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(() => withDb((sql) => addGroupMember(sql, currentUserId(), field(form, "groupId"), field(form, "personId"))));
}

export async function archiveGroupAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return run(() => withDb((sql) => archiveGroup(sql, currentUserId(), field(form, "id")).then(() => undefined)));
}
