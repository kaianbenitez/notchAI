"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AccountWithBalance } from "../accounts/repo";
import { updateTransactionAction } from "../app/log/edit/actions";
import type { EditableTransaction } from "../transactions/edit";

function accountLabel(account: AccountWithBalance): string {
  return account.name;
}

export function EditTransactionForm({ transaction, accounts }: { transaction: EditableTransaction; accounts: AccountWithBalance[] }) {
  const router = useRouter();
  const [occurredAt, setOccurredAt] = useState(transaction.occurredAt);
  const [payee, setPayee] = useState(transaction.payee ?? "");
  const [categoryId, setCategoryId] = useState(transaction.categoryId);
  const [accountId, setAccountId] = useState(transaction.accountId);
  const [memo, setMemo] = useState(transaction.memo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const categories = accounts.filter((a) => a.role === (transaction.direction === "out" ? "expense" : "income"));
  const fundingAccounts = accounts.filter((a) => transaction.direction === "out" ? a.role === "asset" || a.role === "liability" : a.role === "asset");
  const payeeLabel = transaction.direction === "out" ? "Payee" : "Payer or source";
  const accountLabelText = transaction.direction === "out" ? "Paid from" : "Paid into";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const form = new FormData();
    form.set("transactionId", transaction.id);
    form.set("occurredAt", occurredAt);
    form.set("payee", payee);
    form.set("categoryId", categoryId);
    form.set("accountId", accountId);
    form.set("memo", memo);
    const result = await updateTransactionAction({ error: null, ok: false }, form);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.push("/month");
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-xl shadow-slate-950/20 sm:p-6">
      <p className="mb-4 text-sm text-slate-400">
        Amount ({transaction.direction === "out" ? "−" : "+"}) isn&apos;t editable here — delete and re-log the transaction if the amount was wrong.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm text-slate-300">Date
          <input type="date" required value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
        </label>
        <label className="grid gap-1.5 text-sm text-slate-300">{payeeLabel}
          <input required maxLength={200} autoComplete="off" value={payee} onChange={(event) => setPayee(event.target.value)} className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
        </label>
        <label className="grid gap-1.5 text-sm text-slate-300">Category
          <select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
            {categories.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm text-slate-300">{accountLabelText}
          <select required value={accountId} onChange={(event) => setAccountId(event.target.value)} className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
            {fundingAccounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm text-slate-300 sm:col-span-2">Memo <span className="text-slate-500">(optional)</span>
          <input maxLength={500} autoComplete="off" value={memo} onChange={(event) => setMemo(event.target.value)} className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
        </label>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}
      <div className="mt-5 flex gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-60">
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={() => router.push("/month")} className="rounded-md border border-slate-700 px-4 py-3 text-sm font-medium text-slate-300 hover:border-slate-500 hover:text-slate-100">
          Cancel
        </button>
      </div>
    </form>
  );
}
