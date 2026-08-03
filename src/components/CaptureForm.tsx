"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AccountWithBalance } from "../accounts/repo";
import { captureTransactionAction } from "../app/log/actions";
import { formatPeso, parseAmountToMinor } from "../money";
import type { RecentTransaction } from "../transactions/capture";
import { IndexedDbCaptureStorage } from "../transactions/indexeddb-capture-storage";
import { OfflineCaptureQueue, type QueuedCapture } from "../transactions/offline-queue";

type Direction = "out" | "in";
type FormValues = Omit<QueuedCapture, "id" | "queuedAt">;
type DisplayTransaction = RecentTransaction & { pending?: boolean; clientId?: string; pendingAmount?: string };

function accountLabel(account: AccountWithBalance): string {
  return account.name;
}

function formData(capture: QueuedCapture): FormData {
  const values = new FormData();
  values.set("direction", capture.direction);
  values.set("occurredAt", capture.occurredAt);
  values.set("payee", capture.payee);
  values.set("amount", capture.amount);
  values.set("categoryId", capture.categoryId);
  values.set("accountId", capture.accountId);
  values.set("memo", capture.memo);
  values.set("clientId", capture.id);
  return values;
}

export function CaptureForm({ accounts, today, initialDirection, recent: initialRecent }: { accounts: AccountWithBalance[]; today: string; initialDirection: Direction; recent: RecentTransaction[] }) {
  const direction = initialDirection;
  const [values, setValues] = useState<FormValues>({ direction, occurredAt: today, payee: "", amount: "", categoryId: "", accountId: "", memo: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [recent, setRecent] = useState<DisplayTransaction[]>(initialRecent);
  const [savedId, setSavedId] = useState<string | null>(null);
  const payeeRef = useRef<HTMLInputElement>(null);
  const handledSavedId = useRef<string | null>(null);
  const storage = useMemo(() => new IndexedDbCaptureStorage(), []);
  const queue = useMemo(() => new OfflineCaptureQueue(storage), [storage]);
  const categories = accounts.filter((a) => a.role === (direction === "out" ? "expense" : "income"));
  const fundingAccounts = accounts.filter((a) => direction === "out" ? a.role === "asset" || a.role === "liability" : a.role === "asset");
  const payeeLabel = direction === "out" ? "Payee" : "Payer or source";
  const accountLabelText = direction === "out" ? "Paid from" : "Paid into";

  const toPendingRow = useCallback((capture: QueuedCapture): DisplayTransaction => {
    const category = accounts.find((account) => account.id === capture.categoryId)?.name ?? "Unknown category";
    const account = accounts.find((item) => item.id === capture.accountId)?.name ?? "Unknown account";
    // Parse the amount here so the row reads the same before and after it syncs.
    // Carrying a placeholder until the next page load would show a real ₱13 entry
    // as ₱0.00 the moment it uploaded — the one thing a money screen must not do.
    let amountMinor = 0;
    let unparseable: string | undefined;
    try {
      amountMinor = Math.abs(parseAmountToMinor(capture.amount));
    } catch {
      // The server will reject it on flush and say why; show what was typed.
      unparseable = capture.amount;
    }
    return { id: capture.id, clientId: capture.id, occurredAt: capture.occurredAt, payee: capture.payee || null, category, account, amountMinor, pending: true, pendingAmount: unparseable };
  }, [accounts]);

  useEffect(() => {
    if (!savedId || handledSavedId.current === savedId) return;
    handledSavedId.current = savedId;
    setValues((current) => ({ ...current, payee: "", amount: "", memo: "" }));
    setPending(false);
    (payeeRef.current as { focus?: () => void } | null)?.focus?.();
  }, [savedId]);

  useEffect(() => {
    let active = true;
    const send = async (capture: QueuedCapture) => {
      const result = await captureTransactionAction({ error: null, transactionId: null }, formData(capture));
      if (result.error || !result.transactionId) throw new Error(result.error ?? "capture did not return an id");
      if (active) setRecent((current) => current.map((item) => item.clientId === capture.id ? { ...item, id: result.transactionId!, pending: false } : item));
    };
    const flush = async () => {
      try {
        const queued = await storage.list();
        if (active) setRecent((current) => {
          const known = new Set(current.map((item) => item.clientId ?? item.id));
          return [...queued.filter((item) => !known.has(item.id)).map(toPendingRow), ...current];
        });
        await queue.flush(send);
      } catch {
        // IndexedDB can be blocked in private browsing. Leave online capture usable.
      }
    };
    void flush();
    window.addEventListener("online", flush);
    return () => { active = false; window.removeEventListener("online", flush); };
  }, [queue, storage, toPendingRow]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    const capture: QueuedCapture = { ...values, id: crypto.randomUUID(), queuedAt: new Date().toISOString() };
    try {
      const result = await captureTransactionAction({ error: null, transactionId: null }, formData(capture));
      if (result.error || !result.transactionId) {
        setError(result.error ?? "Something went wrong. Check the server log.");
        setPending(false);
        return;
      }
      setRecent((current) => [
        { ...toPendingRow(capture), id: result.transactionId!, pending: false },
        ...current,
      ]);
      setSavedId(result.transactionId);
    } catch {
      try {
        await storage.put(capture);
        setRecent((current) => [toPendingRow(capture), ...current]);
        setNotice("Saved on this device and waiting to sync.");
        setSavedId(capture.id);
      } catch {
        setError("Could not reach the server, and this browser could not save the capture offline.");
        setPending(false);
      }
    }
  }

  return <>
    <form onSubmit={submit} className="border border-slate-800 bg-slate-900/40 p-5 sm:p-6">
      <div className="mb-5 flex border-b border-slate-700">
        {(["out", "in"] as const).map((choice) => <a key={choice} href={choice === "out" ? "/log" : "/log?direction=in"} className={`border-b-2 px-4 py-2 text-sm font-medium ${direction === choice ? "border-emerald-400 text-slate-100" : "border-transparent text-slate-400 hover:text-slate-200"}`}>
          {choice === "out" ? "Money out" : "Money in"}
        </a>)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm text-slate-300">Date
          <input name="occurredAt" type="date" required value={values.occurredAt} onChange={(event) => setValues({ ...values, occurredAt: event.target.value })} className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
        </label>
        <label className="grid gap-1.5 text-sm text-slate-300">{payeeLabel}
          <input ref={payeeRef} name="payee" required maxLength={200} autoComplete="off" value={values.payee} onChange={(event) => setValues({ ...values, payee: event.target.value })} placeholder={direction === "out" ? "e.g. Jollibee" : "e.g. Salary"} className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-600" />
        </label>
        <label className="grid gap-1.5 text-sm text-slate-300">Amount
          <input name="amount" required inputMode="decimal" autoComplete="off" value={values.amount} onChange={(event) => setValues({ ...values, amount: event.target.value })} placeholder="0.00" className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-600" />
        </label>
        <label className="grid gap-1.5 text-sm text-slate-300">Category
          <select name="categoryId" required value={values.categoryId} onChange={(event) => setValues({ ...values, categoryId: event.target.value })} className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
            <option value="" disabled>Choose a category</option>
            {categories.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm text-slate-300">{accountLabelText}
          <select name="accountId" required value={values.accountId} onChange={(event) => setValues({ ...values, accountId: event.target.value })} className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
            <option value="" disabled>Choose an account</option>
            {fundingAccounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm text-slate-300">Memo <span className="text-slate-500">(optional)</span>
          <input name="memo" maxLength={500} autoComplete="off" value={values.memo} onChange={(event) => setValues({ ...values, memo: event.target.value })} className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
        </label>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}
      {notice && <p role="status" className="mt-4 text-sm text-amber-300">{notice}</p>}
      <button type="submit" disabled={pending} className="mt-5 bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60">
        {pending ? "Saving…" : "Save transaction"}
      </button>
    </form>
    <section className="mt-10">
      <h2 className="text-lg font-medium">Recent transactions</h2>
      {recent.length === 0 ? <p className="mt-3 text-sm text-slate-400">Nothing logged yet.</p> : <ul className="mt-3 divide-y divide-slate-800 border-y border-slate-800">
        {recent.map((transaction) => <li key={transaction.id} className="grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1 py-3 text-sm">
          <time className="text-slate-500">{transaction.occurredAt}</time>
          <span className="font-medium">{transaction.payee ?? "—"}{transaction.pending && <span className="ml-2 text-xs font-normal text-amber-300">Pending sync</span>}</span>
          <span className="tabular-nums text-slate-100">{transaction.pendingAmount ?? formatPeso(transaction.amountMinor)}</span>
          <span className="col-start-2 text-slate-400">{transaction.category} · {transaction.account}</span>
        </li>)}
      </ul>}
    </section>
  </>;
}
