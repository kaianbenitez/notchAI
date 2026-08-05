"use client";

import { useState } from "react";

import { formatPeso } from "../../money";
import { commitImportAction, extractStatementAction } from "./actions";
import {
  EMPTY_COMMIT_IMPORT_STATE,
  EMPTY_EXTRACT_IMPORT_STATE,
  type CommitImportState,
  type ExtractImportState,
  type ImportCategory,
} from "./action-state";

type Choice = "matched" | "new" | "skip" | "";
type RowChoice = { choice: Choice; categoryId: string };

function initialChoices(state: ExtractImportState): Record<string, RowChoice> {
  return Object.fromEntries(state.charges.map((row) => [row.id, {
    choice: row.classification === "auto" ? "matched" : row.classification === "none" ? "new" : "",
    categoryId: row.candidate?.categoryId ?? row.suggestedCategoryId,
  }]));
}

function RowHeading({ date, payee, amount, duplicateInStatement = false }: { date: string; payee: string; amount: number; duplicateInStatement?: boolean }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
    <span className="font-medium text-slate-100">{payee}</span>
    <span className="tabular-nums text-slate-100">{formatPeso(amount)}</span>
    <time className="text-xs text-slate-500">{date}</time>
    {duplicateInStatement && <span className="text-xs text-amber-300">Repeated in this statement</span>}
  </div>;
}

export function ImportReview({ accounts, categories }: { accounts: { id: string; name: string }[]; categories: ImportCategory[] }) {
  const [extract, setExtract] = useState<ExtractImportState>(EMPTY_EXTRACT_IMPORT_STATE);
  const [choices, setChoices] = useState<Record<string, RowChoice>>({});
  const [extracting, setExtracting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commit, setCommit] = useState<CommitImportState>(EMPTY_COMMIT_IMPORT_STATE);

  const unresolved = extract.charges.some((row) => {
    const choice = choices[row.id];
    return !choice?.choice || (choice.choice === "new" && !choice.categoryId) || (choice.choice === "matched" && !choice.categoryId);
  });

  function update(id: string, update: Partial<RowChoice>) {
    setChoices((current) => ({ ...current, [id]: { ...current[id], ...update } }));
  }

  async function extractStatement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (extracting) return;
    setExtracting(true);
    setCommit(EMPTY_COMMIT_IMPORT_STATE);
    try {
      const result = await extractStatementAction(EMPTY_EXTRACT_IMPORT_STATE, new FormData(event.currentTarget));
      setExtract(result);
      setChoices(initialChoices(result));
    } catch {
      setExtract({ ...EMPTY_EXTRACT_IMPORT_STATE, error: "Could not upload that statement." });
    } finally {
      setExtracting(false);
    }
  }

  async function submitImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (committing || unresolved || !extract.ingestEventId || !extract.accountId) return;
    setCommitting(true);
    try {
      setCommit(await commitImportAction(EMPTY_COMMIT_IMPORT_STATE, new FormData(event.currentTarget)));
    } catch {
      setCommit({ error: "Could not submit the reviewed rows.", succeeded: [], failed: [] });
    } finally {
      setCommitting(false);
    }
  }

  return <>
    <form onSubmit={extractStatement} className="border border-slate-800 bg-slate-900/40 p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm text-slate-300">Credit-card account
          <select name="accountId" required defaultValue="" className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
            <option value="" disabled>Choose the statement account</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm text-slate-300">Statement PDF
          <input name="pdf" type="file" accept="application/pdf,.pdf" required className="border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300 file:mr-3 file:border-0 file:bg-transparent file:text-slate-300" />
        </label>
        <label className="grid gap-1.5 text-sm text-slate-300">PDF password
          <input name="password" type="password" autoComplete="current-password" className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
        </label>
      </div>
      {extract.error && <p role="alert" className="mt-4 text-sm text-red-400">{extract.error}</p>}
      <button type="submit" disabled={extracting || accounts.length === 0} className="mt-5 bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60">
        {extracting ? "Reading statement…" : "Extract statement"}
      </button>
      {accounts.length === 0 && <p className="mt-3 text-sm text-amber-300">Create an active credit-card account before importing a statement.</p>}
    </form>

    {extract.ingestEventId && <form onSubmit={submitImport} className="mt-8 space-y-8">
      <input type="hidden" name="ingestEventId" value={extract.ingestEventId} />
      <input type="hidden" name="accountId" value={extract.accountId ?? ""} />
      <input type="hidden" name="decisions" value={JSON.stringify(extract.charges.map((row) => {
        const choice = choices[row.id];
        if (choice?.choice === "matched") return { kind: "matched", oldTransactionId: row.candidate?.id ?? "", statementRow: row.statementRow, categoryId: choice.categoryId };
        if (choice?.choice === "new") return { kind: "new", statementRow: row.statementRow, categoryId: choice.categoryId };
        return { kind: "skip", statementRow: row.statementRow };
      }))} />

      <section>
        <h2 className="text-lg font-medium">Matched rows</h2>
        <p className="mt-1 text-sm text-slate-400">These are high-confidence replacements for transactions you already logged.</p>
        {extract.charges.filter((row) => row.classification === "auto").length === 0 ? <p className="mt-3 text-sm text-slate-500">None.</p> : <div className="mt-3 divide-y divide-slate-800 border-y border-slate-800">
          {extract.charges.filter((row) => row.classification === "auto").map((row) => <article key={row.id} className="py-4">
            <RowHeading date={row.statementRow.occurredAt} payee={row.statementRow.payee} amount={row.statementRow.amountMinor} duplicateInStatement={row.duplicateInStatement} />
            <p className="mt-1 text-sm text-slate-400">Logged: {row.candidate?.payee || "—"} · {row.candidate ? formatPeso(row.candidate.amountMinor) : "—"} · {row.candidate?.occurredAt} · score {row.score.toFixed(1)}</p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-300">
              <label><input type="radio" checked={choices[row.id]?.choice === "matched"} onChange={() => update(row.id, { choice: "matched" })} /> <span className="ml-2">Accept match</span></label>
              <label><input type="radio" checked={choices[row.id]?.choice === "new"} onChange={() => update(row.id, { choice: "new" })} /> <span className="ml-2">Treat as new</span></label>
              <label><input type="radio" checked={choices[row.id]?.choice === "skip"} onChange={() => update(row.id, { choice: "skip" })} /> <span className="ml-2">Skip</span></label>
            </div>
            {choices[row.id]?.choice !== "skip" && <CategoryPicker value={choices[row.id]?.categoryId ?? ""} categories={categories} onChange={(categoryId) => update(row.id, { categoryId })} />}
          </article>)}
        </div>}
      </section>

      <section>
        <h2 className="text-lg font-medium">Suggested rows</h2>
        <p className="mt-1 text-sm text-slate-400">Review these possible matches; none are applied until you choose.</p>
        {extract.charges.filter((row) => row.classification === "suggested").length === 0 ? <p className="mt-3 text-sm text-slate-500">None.</p> : <div className="mt-3 divide-y divide-slate-800 border-y border-slate-800">
          {extract.charges.filter((row) => row.classification === "suggested").map((row) => <article key={row.id} className="py-4">
            <RowHeading date={row.statementRow.occurredAt} payee={row.statementRow.payee} amount={row.statementRow.amountMinor} duplicateInStatement={row.duplicateInStatement} />
            <p className="mt-1 text-sm text-slate-400">Possible logged row: {row.candidate?.payee || "—"} · {row.candidate ? formatPeso(row.candidate.amountMinor) : "—"} · {row.candidate?.occurredAt} · score {row.score.toFixed(1)}</p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-300">
              {(["matched", "new", "skip"] as const).map((choice) => <label key={choice}><input type="radio" name={`suggestion-${row.id}`} checked={choices[row.id]?.choice === choice} onChange={() => update(row.id, { choice })} /> <span className="ml-2">{choice === "matched" ? "Match logged row" : choice === "new" ? "Treat as new" : "Skip"}</span></label>)}
            </div>
            {choices[row.id]?.choice && choices[row.id]?.choice !== "skip" && <CategoryPicker value={choices[row.id]?.categoryId ?? ""} categories={categories} onChange={(categoryId) => update(row.id, { categoryId })} />}
          </article>)}
        </div>}
      </section>

      <section>
        <h2 className="text-lg font-medium">New rows</h2>
        <p className="mt-1 text-sm text-slate-400">Pick an expense category for every new charge before importing.</p>
        {extract.charges.filter((row) => row.classification === "none").length === 0 ? <p className="mt-3 text-sm text-slate-500">None.</p> : <div className="mt-3 divide-y divide-slate-800 border-y border-slate-800">
          {extract.charges.filter((row) => row.classification === "none").map((row) => <article key={row.id} className="py-4">
            <RowHeading date={row.statementRow.occurredAt} payee={row.statementRow.payee} amount={row.statementRow.amountMinor} duplicateInStatement={row.duplicateInStatement} />
            <CategoryPicker value={choices[row.id]?.categoryId ?? ""} categories={categories} onChange={(categoryId) => update(row.id, { categoryId })} />
            <label className="mt-3 inline-flex text-sm text-slate-300"><input type="checkbox" checked={choices[row.id]?.choice === "skip"} onChange={(event) => update(row.id, { choice: event.target.checked ? "skip" : "new" })} /> <span className="ml-2">Skip this row</span></label>
          </article>)}
        </div>}
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <ReadOnlyRows title="Payments and credits" empty="No payments or credits were extracted." rows={extract.paymentsAndCredits.map((row) => ({ date: row.occurredAt, payee: row.payee, amount: row.amountMinor }))} />
        <ReadOnlyRows title="Logged but not found on statement" empty="No unmatched logged charges in this date range." rows={extract.unmatchedCandidates.map((row) => ({ date: row.occurredAt, payee: row.payee, amount: row.amountMinor }))} />
      </section>

      {commit.error && <p role="alert" className="text-sm text-red-400">{commit.error}</p>}
      {(commit.succeeded.length > 0 || commit.failed.length > 0) && <section className="border border-slate-800 bg-slate-900/40 p-4 text-sm">
        <h2 className="font-medium">Import result</h2>
        {commit.succeeded.length > 0 && <p className="mt-2 text-emerald-300">Imported {commit.succeeded.length} row{commit.succeeded.length === 1 ? "" : "s"}.</p>}
        {commit.failed.length > 0 && <ul className="mt-2 space-y-1 text-red-400">{commit.failed.map((failure) => <li key={`${failure.row}-${failure.reason}`}>{failure.row}: {failure.reason}</li>)}</ul>}
      </section>}
      <button type="submit" disabled={committing || unresolved} className="bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60">
        {committing ? "Importing…" : "Commit reviewed rows"}
      </button>
      {unresolved && <p className="text-sm text-amber-300">Choose an action for every suggested row and a category for every row being imported.</p>}
    </form>}
  </>;
}

function CategoryPicker({ value, categories, onChange }: { value: string; categories: ImportCategory[]; onChange: (value: string) => void }) {
  return <label className="mt-3 grid max-w-sm gap-1.5 text-sm text-slate-300">Expense category
    <select value={value} onChange={(event) => onChange(event.target.value)} className="border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
      <option value="">Choose a category</option>
      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
    </select>
  </label>;
}

function ReadOnlyRows({ title, empty, rows }: { title: string; empty: string; rows: { date: string; payee: string; amount: number }[] }) {
  return <section>
    <h2 className="text-lg font-medium">{title}</h2>
    {rows.length === 0 ? <p className="mt-2 text-sm text-slate-500">{empty}</p> : <ul className="mt-2 divide-y divide-slate-800 border-y border-slate-800">{rows.map((row, index) => <li key={`${row.date}-${row.payee}-${index}`} className="py-2 text-sm"><RowHeading date={row.date} payee={row.payee} amount={row.amount} /></li>)}</ul>}
  </section>;
}
