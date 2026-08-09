"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { AccountWithBalance } from "../accounts/repo";
import { createCardStatementAction, payCardStatementAction, saveCardCutoffAction } from "../app/accounts/card-actions";
import { NO_ERROR } from "../app/accounts/action-state";
import type { CreditCardActivity, CreditCardStatement } from "../credit-cards/repo";
import { formatPeso } from "../money";

const INPUT = "rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none";
const BUTTON = "rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50";

export function CreditCardProfile({ card, fundingAccounts, cutoffDay, statements, activity, today }: { card: AccountWithBalance; fundingAccounts: AccountWithBalance[]; cutoffDay: number | null; statements: CreditCardStatement[]; activity: CreditCardActivity[]; today: string }) {
  const active = statements.find((statement) => statement.status === "active") ?? null;
  const charged = activity.reduce((sum, item) => sum + item.chargedMinor, 0);
  const credits = activity.reduce((sum, item) => sum + item.creditMinor, 0);
  const personal = activity.reduce((sum, item) => sum + item.personalExpenseMinor, 0);
  const loggedNet = charged - credits;
  return <main className="mx-auto w-full max-w-3xl px-6 py-10">
    <Link href="/accounts" className="text-sm text-emerald-300 hover:text-emerald-200">← Accounts</Link>
    <header className="mt-5 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-slate-400">Credit card</p><h1 className="text-3xl font-semibold tracking-tight text-slate-100">{card.name}</h1></div><p className="text-xl tabular-nums text-slate-200">You owe {formatPeso(card.displayBalanceMinor)}</p></header>

    <section className="mt-8 rounded-lg border border-slate-800 bg-slate-900/40 p-5"><h2 className="text-lg font-medium text-slate-100">Statement</h2>
      {cutoffDay === null ? <CutoffForm accountId={card.id} /> : active ? <ActiveStatement statement={active} cardId={card.id} fundingAccounts={fundingAccounts} today={today} loggedNet={loggedNet} /> : <StatementForm accountId={card.id} today={today} cutoffDay={cutoffDay} />}
    </section>

    {cutoffDay !== null && <p className="mt-3 text-sm text-slate-400">Statement cycle closes on day {cutoffDay} of each month. <CutoffForm accountId={card.id} compact /></p>}

    <section className="mt-8"><h2 className="text-xl font-semibold text-slate-100">This statement&apos;s activity</h2><p className="mt-1 text-sm text-slate-400">Full card charges include shared purchases; personal expenses include only your share.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3"><Metric label="Charged" value={charged} /><Metric label="Credits & payments" value={credits} /><Metric label="Your expenses" value={personal} /></div>
      {activity.length === 0 ? <p className="mt-5 rounded-lg border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-500">No logged card activity in this statement period yet.</p> : <ul className="mt-5 divide-y divide-slate-800 rounded-lg border border-slate-800">{activity.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3"><div className="min-w-36 flex-1"><p className="text-sm text-slate-100">{item.payee ?? "Card activity"}</p><p className="text-xs text-slate-500">{item.occurredAt}</p></div><div className="text-right text-xs text-slate-400"><p>Charged {formatPeso(item.chargedMinor)}</p>{item.creditMinor > 0 && <p>Credit {formatPeso(item.creditMinor)}</p>}<p>Your expense {formatPeso(item.personalExpenseMinor)}</p></div></li>)}</ul>}
    </section>

    {statements.some((statement) => statement.status === "paid") && <section className="mt-8"><h2 className="text-lg font-medium text-slate-100">Paid statements</h2><ul className="mt-3 divide-y divide-slate-800 rounded-lg border border-slate-800">{statements.filter((statement) => statement.status === "paid").map((statement) => <li key={statement.id} className="flex justify-between gap-3 px-4 py-3 text-sm"><span className="text-slate-300">{statement.periodStartsOn} to {statement.periodEndsOn}</span><span className="tabular-nums text-emerald-300">Paid {formatPeso(statement.statementAmountMinor)}</span></li>)}</ul></section>}
  </main>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-lg border border-slate-800 px-4 py-3"><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 tabular-nums text-lg text-slate-100">{formatPeso(value)}</p></div>; }
function ErrorNote({ message }: { message: string | null }) { return message ? <p role="alert" className="mt-3 text-sm text-red-400">{message}</p> : null; }

function CutoffForm({ accountId, compact = false }: { accountId: string; compact?: boolean }) {
  const [state, submit, pending] = useActionState(saveCardCutoffAction, NO_ERROR);
  return <form action={submit} className={compact ? "mt-2 inline-flex flex-wrap items-center gap-2" : "mt-4 grid max-w-md gap-3"}><input type="hidden" name="accountId" value={accountId} /><label className="grid gap-1.5 text-sm text-slate-300">{compact ? "Change cutoff" : "Statement cutoff day"}<select name="cutoffDay" defaultValue="1" className={INPUT}>{Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>Day {i + 1}</option>)}</select></label><button type="submit" disabled={pending} className={`${BUTTON} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}>{pending ? "Saving…" : compact ? "Save" : "Set cutoff"}</button><ErrorNote message={state.error} /></form>;
}

function StatementForm({ accountId, today, cutoffDay }: { accountId: string; today: string; cutoffDay: number }) {
  const [state, submit, pending] = useActionState(createCardStatementAction, NO_ERROR);
  return <form action={submit} className="mt-4 grid gap-4 sm:grid-cols-2"><input type="hidden" name="accountId" value={accountId} /><input type="hidden" name="today" value={today} /><p className="sm:col-span-2 text-sm text-slate-400">Enter the bank&apos;s issued amount and due date. It will cover the cycle that closed on day {cutoffDay}.</p><label className="grid gap-1.5 text-sm text-slate-300">Statement balance<input name="amount" required inputMode="decimal" placeholder="0.00" className={INPUT} /></label><label className="grid gap-1.5 text-sm text-slate-300">Due date<input name="dueOn" type="date" required className={INPUT} /></label><div className="sm:col-span-2"><button type="submit" disabled={pending} className={`${BUTTON} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}>{pending ? "Saving…" : "Add statement"}</button><ErrorNote message={state.error} /></div></form>;
}

function ActiveStatement({ statement, cardId, fundingAccounts, today, loggedNet }: { statement: CreditCardStatement; cardId: string; fundingAccounts: AccountWithBalance[]; today: string; loggedNet: number }) {
  const difference = statement.statementAmountMinor - loggedNet;
  const [state, submit, pending] = useActionState(payCardStatementAction, NO_ERROR);
  return <><dl className="mt-4 grid gap-3 sm:grid-cols-3"><Metric label="Statement balance" value={statement.statementAmountMinor} /><div className="rounded-lg border border-slate-800 px-4 py-3"><dt className="text-xs uppercase tracking-wide text-slate-500">Due</dt><dd className="mt-1 text-lg text-slate-100">{statement.dueOn}</dd></div><div className="rounded-lg border border-slate-800 px-4 py-3"><dt className="text-xs uppercase tracking-wide text-slate-500">Logged difference</dt><dd className="mt-1 tabular-nums text-lg text-slate-100">{formatPeso(difference)}</dd></div></dl><p className="mt-3 text-sm text-slate-400">{statement.currentReminderRung ? `Latest reminder: ${statement.currentReminderRung.replaceAll("_", " ")}.` : "Telegram reminders start 5 days before the due date."}</p><form action={submit} className="mt-5 flex flex-wrap items-end gap-3"><input type="hidden" name="accountId" value={cardId} /><input type="hidden" name="statementId" value={statement.id} /><input type="hidden" name="paidOn" value={today} /><label className="grid gap-1.5 text-sm text-slate-300">Pay from<select name="fundingAccountId" required className={INPUT}><option value="" disabled>Select account</option>{fundingAccounts.filter((account) => account.archivedAt === null).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><button type="submit" disabled={pending || fundingAccounts.length === 0} className={`${BUTTON} bg-emerald-500 text-slate-950 hover:bg-emerald-400`}>{pending ? "Paying…" : `Pay ${formatPeso(statement.statementAmountMinor)}`}</button><ErrorNote message={state.error} /></form></>;
}
