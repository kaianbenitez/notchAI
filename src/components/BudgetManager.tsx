"use client";

import { useActionState, useState } from "react";

import type { AccountWithBalance } from "../accounts/repo";
import type { Budget } from "../budgets/repo";
import { NO_ERROR, type ActionState } from "../app/budgets/action-state";
import { archiveBudgetAction, createBudgetAction, unarchiveBudgetAction, updateBudgetAction } from "../app/budgets/actions";
import { formatPeso } from "../money";

const INPUT = "rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none";
const BUTTON = "rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50";

export function BudgetManager({ budgets, categories, currentMonth }: { budgets: Budget[]; categories: AccountWithBalance[]; currentMonth: string }) {
  const [showArchived, setShowArchived] = useState(false);
  const activeCategoryIds = new Set(budgets.filter((budget) => budget.archivedAt === null).map((budget) => budget.accountId));
  const available = categories.filter((category) => category.archivedAt === null && !activeCategoryIds.has(category.id));
  const visible = budgets.filter((budget) => showArchived || budget.archivedAt === null);
  return <main className="mx-auto w-full max-w-3xl px-6 py-12">
    <header className="mb-8"><h1 className="text-3xl font-semibold tracking-tight text-slate-100">Budgets</h1><p className="mt-2 text-sm text-slate-400">A flat monthly amount for each expense category. Rollover carries both leftover money and overspending forward.</p></header>
    <CreateForm categories={available} currentMonth={currentMonth} />
    <div className="mt-10">{visible.length === 0 ? <p className="rounded-lg border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-500">No budgets yet. Give the categories you watch most a monthly limit.</p> : <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">{visible.map((budget) => <BudgetRow key={budget.id} budget={budget} />)}</ul>}
      {budgets.some((budget) => budget.archivedAt !== null) && <button type="button" onClick={() => setShowArchived((value) => !value)} className="mt-4 text-sm text-slate-400 underline underline-offset-4 hover:text-slate-200">{showArchived ? "Hide archived" : "Show archived"}</button>}
    </div>
  </main>;
}

function CreateForm({ categories, currentMonth }: { categories: AccountWithBalance[]; currentMonth: string }) {
  const [state, submit, pending] = useActionState(createBudgetAction, NO_ERROR);
  if (categories.length === 0) return <p className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-500">Every active expense category already has a budget, or create an expense category first.</p>;
  return <form action={submit} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"><div className="flex flex-wrap items-center gap-3">
    <select name="accountId" className={INPUT}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
    <input name="amount" required inputMode="decimal" placeholder="Monthly amount" className={`${INPUT} min-w-36 flex-1`} />
    <input name="startsOn" required type="month" defaultValue={currentMonth} className={INPUT} />
    <label className="flex items-center gap-2 text-sm text-slate-300"><input name="rolloverEnabled" type="checkbox" /> Rollover</label>
    <button type="submit" disabled={pending} className={`${BUTTON} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}>{pending ? "Adding…" : "Add"}</button>
  </div>{state.error && <ErrorNote message={state.error} />}</form>;
}

function BudgetRow({ budget }: { budget: Budget }) {
  const [editing, setEditing] = useState(false); const archived = budget.archivedAt !== null;
  return <li className={archived ? "opacity-50" : undefined}><div className="flex flex-wrap items-center gap-3 px-4 py-3">{editing ? <EditForm budget={budget} onDone={() => setEditing(false)} /> : <>
    <span className="flex-1 text-sm text-slate-100">{budget.categoryName}{archived && <span className="ml-2 text-xs uppercase tracking-wide text-slate-500">archived</span>}</span>
    <span className="text-xs text-slate-500">from {budget.startsOn}</span><span className="tabular-nums text-sm text-slate-300">{formatPeso(budget.amountMinor)}</span>
    <span className="text-xs text-slate-400">{budget.rolloverEnabled ? "Rollover on" : "Flat"}</span>
    {!archived ? <><button type="button" onClick={() => setEditing(true)} className={`${BUTTON} text-slate-400 hover:text-slate-100`}>Edit</button><ArchiveButton budget={budget} /></> : <RestoreButton budget={budget} />}
  </>}</div></li>;
}

function EditForm({ budget, onDone }: { budget: Budget; onDone: () => void }) {
  const [state, submit, pending] = useActionState(async (previous: ActionState, form: FormData) => { const result = await updateBudgetAction(previous, form); if (!result.error) onDone(); return result; }, NO_ERROR);
  return <form action={submit} className="flex flex-1 flex-wrap items-center gap-3"><input type="hidden" name="id" value={budget.id} /><input name="amount" required inputMode="decimal" defaultValue={formatPeso(budget.amountMinor)} className={`${INPUT} min-w-36 flex-1`} /><label className="flex items-center gap-2 text-sm text-slate-300"><input name="rolloverEnabled" type="checkbox" defaultChecked={budget.rolloverEnabled} /> Rollover</label><button type="submit" disabled={pending} className={`${BUTTON} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}>Save</button><button type="button" onClick={onDone} className={`${BUTTON} text-slate-400 hover:text-slate-100`}>Cancel</button>{state.error && <ErrorNote message={state.error} />}</form>;
}

function ArchiveButton({ budget }: { budget: Budget }) { const [state, archive, pending] = useActionState(archiveBudgetAction, NO_ERROR); return <form action={archive}><input type="hidden" name="id" value={budget.id} /><button type="submit" disabled={pending} className={`${BUTTON} text-slate-500 hover:text-red-400`}>Archive</button>{state.error && <ErrorNote message={state.error} />}</form>; }
function RestoreButton({ budget }: { budget: Budget }) { const [state, restore, pending] = useActionState(unarchiveBudgetAction, NO_ERROR); return <form action={restore}><input type="hidden" name="id" value={budget.id} /><button type="submit" disabled={pending} className={`${BUTTON} text-slate-400 hover:text-slate-100`}>Restore</button>{state.error && <ErrorNote message={state.error} />}</form>; }
function ErrorNote({ message }: { message: string }) { return <p role="alert" className="w-full text-sm text-red-400">{message}</p>; }
