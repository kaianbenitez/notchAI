"use client";

import { useActionState, useState } from "react";

import { addGroupMemberAction, archiveGroupAction, createGroupAction } from "../app/groups/actions";
import { NO_ERROR, type ActionState } from "../app/groups/action-state";
import type { Group } from "../groups/repo";
import { formatPeso } from "../money";
import type { PersonWithBalance } from "../people/repo";

const INPUT = "rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none";
const BUTTON = "rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50";

export function GroupManager({ groups, people, membersByGroup }: { groups: Group[]; people: PersonWithBalance[]; membersByGroup: Record<string, PersonWithBalance[]> }) {
  const [showArchived, setShowArchived] = useState(false);
  const visibleGroups = groups.filter((group) => showArchived || group.archivedAt === null);
  return <main className="mx-auto w-full max-w-3xl px-6 py-12"><header className="mb-8"><h1 className="text-3xl font-semibold tracking-tight text-slate-100">Groups</h1><p className="mt-2 text-sm text-slate-400">Keep a shared trip, household, or regular crew together when you split expenses.</p></header><CreateForm /><div className="mt-6 flex justify-end"><button type="button" onClick={() => setShowArchived((value) => !value)} className={`${BUTTON} text-slate-400 hover:text-slate-100`}>{showArchived ? "Hide archived" : "Show archived"}</button></div><div className="mt-3">{visibleGroups.length === 0 ? <p className="rounded-lg border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-500">{showArchived ? "No groups yet." : "No active groups yet. Create one for your next shared expense."}</p> : <ul className="space-y-4">{visibleGroups.map((group) => <GroupCard key={group.id} group={group} people={people} members={membersByGroup[group.id] ?? []} />)}</ul>}</div></main>;
}

function CreateForm() {
  const [state, submit, pending] = useActionState(createGroupAction, NO_ERROR);
  return <form action={submit} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"><div className="flex flex-wrap items-center gap-3"><input name="name" required placeholder="Group name" className={`${INPUT} min-w-40 flex-1`} /><button type="submit" disabled={pending} className={`${BUTTON} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}>{pending ? "Creating…" : "Create group"}</button></div><p className="mt-2 text-xs text-slate-500">Currency defaults to PHP.</p>{state.error && <ErrorNote message={state.error} />}</form>;
}

function GroupCard({ group, people, members }: { group: Group; people: PersonWithBalance[]; members: PersonWithBalance[] }) {
  const [adding, setAdding] = useState(false);
  const memberIds = new Set(members.map((member) => member.id));
  const availablePeople = people.filter((person) => !memberIds.has(person.id));
  const archived = group.archivedAt !== null;
  return <li className={`rounded-lg border border-slate-800 bg-slate-900/40 p-4 ${archived ? "opacity-50" : ""}`}><div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><h2 className="text-base font-medium text-slate-100">{group.name}{archived && <span className="ml-2 text-xs uppercase tracking-wide text-slate-500">archived</span>}</h2><p className="mt-1 text-xs text-slate-500">{group.currency}</p></div>{!archived && <button type="button" onClick={() => setAdding((value) => !value)} className={`${BUTTON} text-slate-400 hover:text-slate-100`}>{adding ? "Cancel" : "Add member"}</button>}{!archived && <ArchiveButton group={group} />}</div><div className="mt-4 border-t border-slate-800 pt-3"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Members</p>{members.length === 0 ? <p className="mt-2 text-sm text-slate-500">No members yet.</p> : <ul className="mt-2 space-y-2">{members.map((member) => <li key={member.id} className="flex justify-between gap-3 text-sm"><span className="text-slate-200">{member.name}</span><MemberBalance balanceMinor={member.balanceMinor} /></li>)}</ul>}</div>{adding && <AddMemberForm groupId={group.id} people={availablePeople} onDone={() => setAdding(false)} />}</li>;
}

function MemberBalance({ balanceMinor }: { balanceMinor: number }) { return <span className={balanceMinor > 0 ? "text-emerald-400" : balanceMinor < 0 ? "text-amber-300" : "text-slate-500"}>{balanceMinor > 0 ? `Owes you ${formatPeso(balanceMinor)}` : balanceMinor < 0 ? `You owe ${formatPeso(Math.abs(balanceMinor))}` : "Settled up"}</span>; }

function AddMemberForm({ groupId, people, onDone }: { groupId: string; people: PersonWithBalance[]; onDone: () => void }) {
  const [state, submit, pending] = useActionState(async (previous: ActionState, form: FormData) => { const result = await addGroupMemberAction(previous, form); if (!result.error) onDone(); return result; }, NO_ERROR);
  return <form action={submit} className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-800 pt-3"><input type="hidden" name="groupId" value={groupId} /><label className="grid flex-1 gap-1.5 text-sm text-slate-300">Contact<select name="personId" required defaultValue="" className={INPUT}><option value="" disabled>Choose a contact</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><button type="submit" disabled={pending || people.length === 0} className={`${BUTTON} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}>{pending ? "Adding…" : "Add member"}</button>{people.length === 0 && <p className="w-full text-sm text-amber-300">All active contacts are already members.</p>}{state.error && <ErrorNote message={state.error} />}</form>;
}

function ArchiveButton({ group }: { group: Group }) { const [state, archive, pending] = useActionState(archiveGroupAction, NO_ERROR); return <form action={archive}><input type="hidden" name="id" value={group.id} /><button type="submit" disabled={pending} className={`${BUTTON} text-slate-500 hover:text-red-400`}>Archive</button>{state.error && <ErrorNote message={state.error} />}</form>; }
function ErrorNote({ message }: { message: string }) { return <p role="alert" className="mt-3 w-full text-sm text-red-400">{message}</p>; }
