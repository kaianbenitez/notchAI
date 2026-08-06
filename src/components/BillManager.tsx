"use client";

import { useActionState, useState } from "react";

import { NO_ERROR, type ActionState } from "../app/bills/action-state";
import { archiveBillAction, createBillAction, markBillPaidAction, updateBillAction } from "../app/bills/actions";
import type { AccountWithBalance } from "../accounts/repo";
import { formatPeso } from "../money";
import type { DetectedBill } from "../reminders/detect";
import type { ReminderRule } from "../reminders/repo";

const INPUT = "rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none";
const BUTTON = "rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50";

interface Props { rules: ReminderRule[]; accounts: AccountWithBalance[]; categories: AccountWithBalance[]; detected: DetectedBill[]; today: string; }

export function BillManager({ rules, accounts, categories, detected, today }: Props) {
  const [showArchived, setShowArchived] = useState(false);
  const visible = rules.filter((rule) => showArchived || rule.archivedAt === null);
  return <main className="mx-auto w-full max-w-3xl px-6 py-12">
    <header className="mb-8"><h1 className="text-3xl font-semibold tracking-tight text-slate-100">Bills</h1><p className="mt-2 text-sm text-slate-400">Track recurring bills and get Telegram reminders before they are due.</p></header>
    {detected.length > 0 && <DetectedBills detected={detected} />}
    <CreateForm accounts={accounts} categories={categories} today={today} />
    <div className="mt-10">
      {visible.length === 0 ? <p className="rounded-lg border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-500">No bills yet. Add a recurring bill to start receiving reminders.</p> : <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">{visible.map((rule) => <BillRow key={rule.id} rule={rule} accounts={accounts} categories={categories} />)}</ul>}
      {rules.some((rule) => rule.archivedAt !== null) && <button type="button" onClick={() => setShowArchived((value) => !value)} className="mt-4 text-sm text-slate-400 underline underline-offset-4 hover:text-slate-200">{showArchived ? "Hide archived" : "Show archived"}</button>}
    </div>
  </main>;
}

function DetectedBills({ detected }: { detected: DetectedBill[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = detected.filter((candidate) => !dismissed.has(candidate.payee + candidate.accountId));
  if (visible.length === 0) return null;
  return <div className="mb-8 rounded-lg border border-emerald-800/50 bg-emerald-950/20 p-4">
    <h2 className="text-sm font-medium text-emerald-300">Looks like a recurring bill</h2>
    <p className="mt-1 text-xs text-slate-400">Spotted from your transaction history. Add the ones you want reminders for.</p>
    <ul className="mt-3 space-y-2">{visible.map((candidate) => <DetectedBillRow key={candidate.payee + candidate.accountId} candidate={candidate} onDismiss={() => setDismissed((prev) => new Set(prev).add(candidate.payee + candidate.accountId))} />)}</ul>
  </div>;
}

function DetectedBillRow({ candidate, onDismiss }: { candidate: DetectedBill; onDismiss: () => void }) {
  const [state, submit, pending] = useActionState(async (previous: ActionState, form: FormData) => { const result = await createBillAction(previous, form); if (!result.error) onDismiss(); return result; }, NO_ERROR);
  return <li className="flex flex-wrap items-center gap-3 rounded-md bg-slate-900/60 px-3 py-2">
    <form action={submit} className="flex flex-1 flex-wrap items-center gap-3">
      <input type="hidden" name="name" value={candidate.payee} /><input type="hidden" name="amount" value={formatPeso(candidate.suggestedAmountMinor)} />
      <input type="hidden" name="accountId" value={candidate.accountId} /><input type="hidden" name="categoryId" value={candidate.categoryId} />
      <input type="hidden" name="recurrencePreset" value={candidate.suggestedRecurrencePreset} /><input type="hidden" name="nextDueOn" value={candidate.suggestedNextDueOn} />
      <span className="flex-1 text-sm text-slate-100">{candidate.payee}<span className="ml-2 text-xs text-slate-500">{candidate.occurrences}× seen, ~monthly</span></span>
      <span className="tabular-nums text-sm text-slate-300">{formatPeso(candidate.suggestedAmountMinor)}</span>
      <button type="submit" disabled={pending} className={`${BUTTON} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}>{pending ? "Adding…" : "Add as bill"}</button>
      <button type="button" onClick={onDismiss} className={`${BUTTON} text-slate-500 hover:text-slate-300`}>Dismiss</button>
      {state.error && <ErrorNote message={state.error} />}
    </form>
  </li>;
}

function CreateForm({ accounts, categories, today }: Pick<Props, "accounts" | "categories" | "today">) {
  const [state, submit, pending] = useActionState(createBillAction, NO_ERROR);
  if (accounts.length === 0 || categories.length === 0) return <p className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-500">Create a funding account and an expense category before adding a bill.</p>;
  return <form action={submit} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"><BillFields accounts={accounts} categories={categories} today={today} /><button type="submit" disabled={pending} className={`${BUTTON} mt-4 bg-emerald-500 text-slate-950 hover:bg-emerald-400`}>{pending ? "Adding…" : "Add bill"}</button>{state.error && <ErrorNote message={state.error} />}</form>;
}

function BillRow({ rule, accounts, categories }: { rule: ReminderRule; accounts: AccountWithBalance[]; categories: AccountWithBalance[] }) {
  const [editing, setEditing] = useState(false); const archived = rule.archivedAt !== null;
  return <li className={archived ? "opacity-50" : undefined}><div className="flex flex-wrap items-center gap-3 px-4 py-3">{editing ? <EditForm rule={rule} accounts={accounts} categories={categories} onDone={() => setEditing(false)} /> : <>
    <span className="flex-1 text-sm text-slate-100">{rule.name}{archived && <span className="ml-2 text-xs uppercase tracking-wide text-slate-500">archived</span>}{rule.lastMatchedTxnId && <span className="ml-2 text-xs text-slate-500">Auto-matched</span>}</span>
    <span className="text-xs text-slate-500">Due {rule.nextDueOn}</span><span className="tabular-nums text-sm text-slate-300">{formatPeso(rule.expectedAmountMinor)}</span>
    <span className="text-xs text-slate-400">{rule.currentReminderAcknowledgedAt ? "Paid" : rule.currentReminderRung ? rule.currentReminderRung.replaceAll("_", " ") : rule.autopay ? "Autopay" : ""}</span>
    {!archived && <><MarkPaidButton rule={rule} /><button type="button" onClick={() => setEditing(true)} className={`${BUTTON} text-slate-400 hover:text-slate-100`}>Edit</button><ArchiveButton rule={rule} /></>}
  </>}</div></li>;
}

function EditForm({ rule, accounts, categories, onDone }: { rule: ReminderRule; accounts: AccountWithBalance[]; categories: AccountWithBalance[]; onDone: () => void }) {
  const [state, submit, pending] = useActionState(async (previous: ActionState, form: FormData) => { const result = await updateBillAction(previous, form); if (!result.error) onDone(); return result; }, NO_ERROR);
  return <form action={submit} className="flex flex-1 flex-wrap items-end gap-3"><input type="hidden" name="id" value={rule.id} /><BillFields accounts={accounts} categories={categories} today={rule.nextDueOn} rule={rule} compact /><button type="submit" disabled={pending} className={`${BUTTON} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}>Save</button><button type="button" onClick={onDone} className={`${BUTTON} text-slate-400 hover:text-slate-100`}>Cancel</button>{state.error && <ErrorNote message={state.error} />}</form>;
}

function BillFields({ accounts, categories, today, rule, compact = false }: { accounts: AccountWithBalance[]; categories: AccountWithBalance[]; today: string; rule?: ReminderRule; compact?: boolean }) {
  return <div className={compact ? "flex flex-1 flex-wrap items-end gap-3" : "grid gap-4 sm:grid-cols-2"}>
    <label className="grid gap-1.5 text-sm text-slate-300">Name<input name="name" required maxLength={120} defaultValue={rule?.name} placeholder="e.g. Internet" className={INPUT} /></label>
    <label className="grid gap-1.5 text-sm text-slate-300">Amount<input name="amount" required inputMode="decimal" defaultValue={rule ? formatPeso(rule.expectedAmountMinor) : undefined} placeholder="0.00" className={INPUT} /></label>
    <label className="grid gap-1.5 text-sm text-slate-300">Funding account<select name="accountId" defaultValue={rule?.accountId} className={INPUT}>{accounts.filter((account) => account.archivedAt === null).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
    <label className="grid gap-1.5 text-sm text-slate-300">Expense category<select name="categoryId" defaultValue={rule?.categoryId} className={INPUT}>{categories.filter((category) => category.archivedAt === null).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
    <label className="grid gap-1.5 text-sm text-slate-300">Recurrence<select name="recurrencePreset" defaultValue={rule?.recurrencePreset ?? "monthly:1"} className={INPUT}>{Array.from({ length: 28 }, (_, index) => <option key={index + 1} value={`monthly:${index + 1}`}>Monthly on day {index + 1}</option>)}{["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((day) => <option key={`weekly-${day}`} value={`weekly:${day}`}>Weekly on {weekday(day)}</option>)}{["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((day) => <option key={`biweekly-${day}`} value={`biweekly:${day}`}>Every 2 weeks on {weekday(day)}</option>)}</select></label>
    <label className="grid gap-1.5 text-sm text-slate-300">Next due date<input name="nextDueOn" type="date" required defaultValue={rule?.nextDueOn ?? today} className={INPUT} /></label>
    <label className="flex items-center gap-2 text-sm text-slate-300"><input name="autopay" type="checkbox" defaultChecked={rule?.autopay} /> Autopay</label>
  </div>;
}

function weekday(value: string): string { return ({ MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday", SU: "Sunday" })[value] ?? value; }
function MarkPaidButton({ rule }: { rule: ReminderRule }) { const [state, submit, pending] = useActionState(markBillPaidAction, NO_ERROR); return <form action={submit}><input type="hidden" name="id" value={rule.id} /><button type="submit" disabled={pending} className={`${BUTTON} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}>{pending ? "Saving…" : "Mark as paid"}</button>{state.error && <ErrorNote message={state.error} />}</form>; }
function ArchiveButton({ rule }: { rule: ReminderRule }) { const [state, submit, pending] = useActionState(archiveBillAction, NO_ERROR); return <form action={submit}><input type="hidden" name="id" value={rule.id} /><button type="submit" disabled={pending} className={`${BUTTON} text-slate-500 hover:text-red-400`}>Archive</button>{state.error && <ErrorNote message={state.error} />}</form>; }
function ErrorNote({ message }: { message: string }) { return <p role="alert" className="w-full text-sm text-red-400">{message}</p>; }
