"use client";

import { useActionState, useState } from "react";

import type { AccountWithBalance } from "../accounts/repo";
import { archivePersonAction, createPersonAction, settleUpAction } from "../app/friends/actions";
import { NO_ERROR, type ActionState } from "../app/friends/action-state";
import { formatPeso } from "../money";
import type { FriendActivity, PersonWithBalance } from "../people/repo";

const INPUT = "rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none";
const BUTTON = "rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50";

export function FriendManager({ people, accounts, archivedFriendIds, activity }: { people: PersonWithBalance[]; accounts: AccountWithBalance[]; archivedFriendIds: string[]; activity: FriendActivity[] }) {
  const archived = new Set(archivedFriendIds);
  const ordered = [...people].sort((a, b) => Number(archived.has(a.id)) - Number(archived.has(b.id)));
  return <main className="mx-auto w-full max-w-3xl px-6 py-12">
    <header className="mb-8"><h1 className="text-3xl font-semibold tracking-tight text-slate-100">Friends</h1><p className="mt-2 text-sm text-slate-400">Track what you owe each other when you share a bill.</p></header>
    <CreateForm />
    <div className="mt-10">{ordered.length === 0 ? <p className="rounded-lg border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-500">No friends yet. Add someone before logging a shared bill.</p> : <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">{ordered.map((person) => <FriendRow key={person.id} person={person} accounts={accounts} archived={archived.has(person.id)} />)}</ul>}</div>
    <RecentActivity activity={activity} />
  </main>;
}

function RecentActivity({ activity }: { activity: FriendActivity[] }) {
  return <section className="mt-10"><h2 className="text-lg font-semibold text-slate-100">Recent activity</h2>{activity.length === 0 ? <p className="mt-3 rounded-lg border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-500">No shared expenses yet.</p> : <ul className="mt-3 divide-y divide-slate-800 rounded-lg border border-slate-800">{activity.map((item) => <ActivityRow key={`${item.transactionId}-${item.personId}`} item={item} />)}</ul>}</section>;
}

function ActivityRow({ item }: { item: FriendActivity }) {
  const positive = item.amountMinor > 0;
  const amount = `${positive ? "+" : "−"}${formatPeso(Math.abs(item.amountMinor))}`;
  const label = positive ? `Owes you ${formatPeso(item.amountMinor)}` : `You owe ${formatPeso(Math.abs(item.amountMinor))}`;
  return <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm"><time dateTime={item.occurredAt} className="text-slate-500">{item.occurredAt}</time><span className="font-medium text-slate-100">{item.payee || item.memo || "Shared expense"}</span><span className="text-slate-400">{item.personName}</span>{item.groupId && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{item.groupName}</span>}<span className={`ml-auto tabular-nums ${positive ? "text-emerald-400" : "text-amber-300"}`}><span>{amount}</span><span className="ml-2 text-xs">{label}</span></span></li>;
}

function CreateForm() {
  const [state, submit, pending] = useActionState(createPersonAction, NO_ERROR);
  return <form action={submit} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"><div className="flex flex-wrap items-center gap-3"><input name="name" required placeholder="Friend's name" className={`${INPUT} min-w-40 flex-1`} /><input name="contact" placeholder="Contact (optional)" className={`${INPUT} min-w-40 flex-1`} /><button type="submit" disabled={pending} className={`${BUTTON} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}>{pending ? "Adding…" : "Add friend"}</button></div>{state.error && <ErrorNote message={state.error} />}</form>;
}

function FriendRow({ person, accounts, archived }: { person: PersonWithBalance; accounts: AccountWithBalance[]; archived: boolean }) {
  const [settling, setSettling] = useState(false);
  const balance = person.balanceMinor;
  const label = balance > 0 ? <span className="text-emerald-400">Owes you {formatPeso(balance)}</span> : balance < 0 ? <span className="text-amber-300">You owe {formatPeso(Math.abs(balance))}</span> : <span className="text-slate-500">Settled up</span>;
  return <li className={archived ? "opacity-50" : undefined}><div className="flex flex-wrap items-center gap-3 px-4 py-3"><span className="flex-1 text-sm text-slate-100">{person.name}{archived && <span className="ml-2 text-xs uppercase tracking-wide text-slate-500">archived</span>}</span><span className="text-sm tabular-nums">{label}</span>{!archived && balance !== 0 && <button type="button" onClick={() => setSettling((value) => !value)} className={`${BUTTON} text-slate-400 hover:text-slate-100`}>{settling ? "Cancel" : "Settle up"}</button>}{!archived && balance === 0 && <ArchiveButton person={person} />}{!archived && balance !== 0 && <span className="text-xs text-slate-500">Settle up before archiving</span>}{settling && <SettleForm person={person} accounts={accounts} onDone={() => setSettling(false)} />}</div></li>;
}

function SettleForm({ person, accounts, onDone }: { person: PersonWithBalance; accounts: AccountWithBalance[]; onDone: () => void }) {
  const direction = person.balanceMinor > 0 ? "they_paid_you" : "you_paid_them";
  const [state, submit, pending] = useActionState(async (previous: ActionState, form: FormData) => { const result = await settleUpAction(previous, form); if (!result.error) onDone(); return result; }, NO_ERROR);
  return <form action={submit} className="flex w-full flex-wrap items-end gap-3 border-t border-slate-800 pt-3"><input type="hidden" name="personId" value={person.id} /><input type="hidden" name="direction" value={direction} /><p className="w-full text-sm text-slate-300">{person.balanceMinor > 0 ? `${person.name} pays you` : `You pay ${person.name}`}</p><label className="grid gap-1.5 text-sm text-slate-300">Amount<input name="amount" required inputMode="decimal" defaultValue={formatPeso(Math.abs(person.balanceMinor))} className={INPUT} /></label><label className="grid flex-1 gap-1.5 text-sm text-slate-300">Account<select name="accountId" required defaultValue="" className={INPUT}><option value="" disabled>Choose an account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><button type="submit" disabled={pending || accounts.length === 0} className={`${BUTTON} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}>{pending ? "Saving…" : "Record settlement"}</button>{accounts.length === 0 && <p className="w-full text-sm text-amber-300">Create an active asset account before settling up.</p>}{state.error && <ErrorNote message={state.error} />}</form>;
}

function ArchiveButton({ person }: { person: PersonWithBalance }) { const [state, archive, pending] = useActionState(archivePersonAction, NO_ERROR); return <form action={archive}><input type="hidden" name="id" value={person.id} /><button type="submit" disabled={pending} className={`${BUTTON} text-slate-500 hover:text-red-400`}>Archive</button>{state.error && <ErrorNote message={state.error} />}</form>; }
function ErrorNote({ message }: { message: string }) { return <p role="alert" className="w-full text-sm text-red-400">{message}</p>; }
