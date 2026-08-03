"use client";

import { useActionState } from "react";

import type { AccountWithBalance } from "../accounts/repo";
import { captureTransactionAction } from "../app/log/actions";
import { NO_ERROR } from "../app/log/action-state";

type Direction = "out" | "in";

function accountLabel(account: AccountWithBalance): string {
  return account.name;
}

export function CaptureForm({ accounts, today, initialDirection }: { accounts: AccountWithBalance[]; today: string; initialDirection: Direction }) {
  const direction = initialDirection;
  const [state, action, pending] = useActionState(captureTransactionAction, NO_ERROR);
  const categories = accounts.filter((a) => a.role === (direction === "out" ? "expense" : "income"));
  const fundingAccounts = accounts.filter((a) =>
    direction === "out" ? a.role === "asset" || a.role === "liability" : a.role === "asset",
  );
  const payeeLabel = direction === "out" ? "Payee" : "Payer or source";
  const accountLabelText = direction === "out" ? "Paid from" : "Paid into";

  return (
    <form action={action} className="border border-slate-800 bg-slate-900/40 p-5 sm:p-6">
      <div className="mb-5 flex border-b border-slate-700">
        {(["out", "in"] as const).map((choice) => (
          <a key={choice} href={choice === "out" ? "/log" : "/log?direction=in"}
            className={`border-b-2 px-4 py-2 text-sm font-medium ${direction === choice ? "border-emerald-400 text-slate-100" : "border-transparent text-slate-400 hover:text-slate-200"}`}>
            {choice === "out" ? "Money out" : "Money in"}
          </a>
        ))}
      </div>
      <input type="hidden" name="direction" value={direction} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm text-slate-300">Date
          <input name="occurredAt" type="date" required defaultValue={today} className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
        </label>
        <label className="grid gap-1.5 text-sm text-slate-300">{payeeLabel}
          <input name="payee" required maxLength={200} autoComplete="off" placeholder={direction === "out" ? "e.g. Jollibee" : "e.g. Salary"} className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-600" />
        </label>
        <label className="grid gap-1.5 text-sm text-slate-300">Amount
          <input name="amount" required inputMode="decimal" autoComplete="off" placeholder="0.00" className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-600" />
        </label>
        <label className="grid gap-1.5 text-sm text-slate-300">Category
          <select name="categoryId" required defaultValue="" className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
            <option value="" disabled>Choose a category</option>
            {categories.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm text-slate-300">{accountLabelText}
          <select name="accountId" required defaultValue="" className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
            <option value="" disabled>Choose an account</option>
            {fundingAccounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm text-slate-300">Memo <span className="text-slate-500">(optional)</span>
          <input name="memo" maxLength={500} autoComplete="off" className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
        </label>
      </div>
      {state.error && <p role="alert" className="mt-4 text-sm text-red-400">{state.error}</p>}
      <button type="submit" disabled={pending} className="mt-5 bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60">
        {pending ? "Saving…" : "Save transaction"}
      </button>
    </form>
  );
}
