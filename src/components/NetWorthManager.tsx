"use client";

import { useActionState, useState } from "react";

import {
  archiveNetWorthLabelAction,
  archiveSavingsGoalAction,
  createSavingsGoalAction,
  recordNetWorthSnapshotAction,
} from "../app/net-worth/actions";
import { NO_ERROR } from "../app/net-worth/action-state";
import type { NetWorthBalance, NetWorthCategory, SavingsGoalProgress } from "../net-worth/repo";
import { formatPeso } from "../money";

const CATEGORIES: { id: NetWorthCategory; label: string }[] = [
  { id: "cash", label: "Cash" }, { id: "investment", label: "Investments" }, { id: "property", label: "Property" }, { id: "vehicle", label: "Vehicles" }, { id: "other", label: "Other assets" },
];
const INPUT = "rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none";
const BUTTON = "rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50";

export function NetWorthManager({ balances, labels, goals, totalMinor, today }: { balances: NetWorthBalance[]; labels: { id: string; name: string; category: NetWorthCategory }[]; goals: SavingsGoalProgress[]; totalMinor: number; today: string }) {
  return <main className="mx-auto w-full max-w-3xl px-6 py-12">
    <header className="mb-8"><h1 className="text-3xl font-semibold tracking-tight text-slate-100">Net worth</h1><p className="mt-2 text-sm text-slate-400">Keep manual PHP snapshots for money and assets that live outside your Notch transaction ledger.</p></header>
    <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5"><p className="text-xs font-medium uppercase tracking-wide text-emerald-300">Current net worth</p><p className="mt-2 text-3xl font-semibold tabular-nums text-slate-100">{formatPeso(totalMinor)}</p><p className="mt-1 text-xs text-slate-500">Assets only; liabilities are not included in this manual tracker.</p></section>
    <section className="mt-8"><h2 className="text-lg font-semibold text-slate-100">Update a balance</h2><p className="mt-1 text-sm text-slate-400">Every update is saved as a new snapshot, preserving its history.</p><SnapshotForm labels={labels} today={today} /></section>
    <section className="mt-10"><h2 className="text-lg font-semibold text-slate-100">Current balances</h2><div className="mt-4 space-y-5">{CATEGORIES.map((category) => {
      const rows = balances.filter((balance) => balance.category === category.id);
      if (rows.length === 0) return null;
      return <div key={category.id}><h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{category.label}</h3><ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/40">{rows.map((balance) => <BalanceRow key={balance.labelId} balance={balance} today={today} />)}</ul></div>;
    })}{balances.length === 0 && <p className="rounded-lg border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-500">No manual balances yet. Add the savings or assets you want to track here.</p>}</div></section>
    <section className="mt-12 border-t border-slate-800 pt-10"><h2 className="text-lg font-semibold text-slate-100">Savings goals</h2><p className="mt-1 text-sm text-slate-400">Link a goal to one balance to see its current progress.</p><GoalForm labels={labels} /><div className="mt-5 space-y-3">{goals.length === 0 ? <p className="rounded-lg border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-500">No savings goals yet.</p> : goals.map((goal) => <GoalCard key={goal.id} goal={goal} />)}</div></section>
  </main>;
}

function SnapshotForm({ labels, today }: { labels: { id: string; name: string; category: NetWorthCategory }[]; today: string }) {
  const [newLabel, setNewLabel] = useState(labels.length === 0); const [state, submit, pending] = useActionState(recordNetWorthSnapshotAction, NO_ERROR);
  return <form action={submit} className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4"><div className="grid gap-3 sm:grid-cols-2">
    {!newLabel && <label className="grid gap-1.5 text-sm text-slate-300">Label<select name="labelId" required className={INPUT}><option value="" disabled>Choose a balance</option>{labels.map((label) => <option key={label.id} value={label.id}>{label.name} · {label.category}</option>)}</select></label>}
    {newLabel && <><label className="grid gap-1.5 text-sm text-slate-300">New label<input name="labelName" required placeholder="Maya HYSA" className={INPUT} /></label><label className="grid gap-1.5 text-sm text-slate-300">Category<select name="category" required defaultValue="cash" className={INPUT}>{CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label></>}
    <label className="grid gap-1.5 text-sm text-slate-300">Balance (PHP)<input name="balance" required inputMode="decimal" placeholder="0.00" className={INPUT} /></label><label className="grid gap-1.5 text-sm text-slate-300">As of<input name="asOf" required type="date" defaultValue={today} className={INPUT} /></label>
  </div><div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" onClick={() => setNewLabel((value) => !value)} className={`${BUTTON} text-slate-400 hover:text-slate-100`}>{newLabel ? "Use an existing label" : "Create a new label"}</button><button type="submit" disabled={pending} className={`${BUTTON} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}>{pending ? "Saving…" : "Save balance"}</button></div>{state.error && <ErrorNote message={state.error} />}</form>;
}

function BalanceRow({ balance, today }: { balance: NetWorthBalance; today: string }) {
  const days = daysSince(balance.asOf, today); const stale = days > 30;
  const [state, archive, pending] = useActionState(archiveNetWorthLabelAction, NO_ERROR);
  return <li className="flex flex-wrap items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-100">{balance.label}</p><p className={stale ? "mt-1 text-xs text-amber-300" : "mt-1 text-xs text-slate-500"}>{relativeDays(days)}{stale && " · update suggested"}</p></div><span className="tabular-nums text-sm text-slate-200">{formatPeso(balance.balanceMinor)}</span><form action={archive}><input type="hidden" name="id" value={balance.labelId} /><button type="submit" disabled={pending} className={`${BUTTON} text-slate-500 hover:text-red-400`}>Archive</button>{state.error && <ErrorNote message={state.error} />}</form></li>;
}

function GoalForm({ labels }: { labels: { id: string; name: string; category: NetWorthCategory }[] }) {
  const [state, submit, pending] = useActionState(createSavingsGoalAction, NO_ERROR);
  return <form action={submit} className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4"><div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1.5 text-sm text-slate-300">Goal name<input name="name" required placeholder="Emergency fund" className={INPUT} /></label><label className="grid gap-1.5 text-sm text-slate-300">Target (PHP)<input name="target" required inputMode="decimal" placeholder="100,000.00" className={INPUT} /></label><label className="grid gap-1.5 text-sm text-slate-300">Linked balance<select name="linkedLabelId" defaultValue="" className={INPUT}><option value="">Not linked</option>{labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}</select></label></div><button type="submit" disabled={pending} className={`${BUTTON} mt-4 bg-emerald-500 text-slate-950 hover:bg-emerald-400`}>{pending ? "Adding…" : "Add goal"}</button>{state.error && <ErrorNote message={state.error} />}</form>;
}

function GoalCard({ goal }: { goal: SavingsGoalProgress }) {
  const [state, archive, pending] = useActionState(archiveSavingsGoalAction, NO_ERROR); const width = Math.min(goal.progressPercent, 100);
  return <article className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"><div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><h3 className="font-medium text-slate-100">{goal.name}</h3><p className="mt-1 text-sm text-slate-400">{goal.linkedLabel ? `Linked to ${goal.linkedLabel}` : "No linked balance yet"}</p></div><form action={archive}><input type="hidden" name="id" value={goal.id} /><button type="submit" disabled={pending} className={`${BUTTON} text-slate-500 hover:text-red-400`}>Archive</button>{state.error && <ErrorNote message={state.error} />}</form></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${width}%` }} /></div><div className="mt-2 flex flex-wrap justify-between gap-2 text-sm"><span className="tabular-nums text-slate-300">{formatPeso(goal.currentMinor)} / {formatPeso(goal.targetMinor)}</span><span className={goal.progressPercent >= 100 ? "font-medium text-emerald-400" : "text-slate-400"}>{goal.progressPercent}%</span></div></article>;
}

function daysSince(asOf: string, today: string): number { return Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000)); }
function relativeDays(days: number): string { return days === 0 ? "Updated today" : days === 1 ? "Updated yesterday" : `Updated ${days} days ago`; }
function ErrorNote({ message }: { message: string }) { return <p role="alert" className="mt-3 text-sm text-red-400">{message}</p>; }
