import { listAccounts } from "../../accounts/repo";
import { currentUserId } from "../../auth";
import { CaptureForm } from "../../components/CaptureForm";
import { withDb } from "../../db/client";
import { formatPeso } from "../../money";
import { listRecentTransactions } from "../../transactions/capture";

export const dynamic = "force-dynamic";

function manilaToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{ direction?: string }>;
}) {
  const direction = (await searchParams).direction === "in" ? "in" : "out";
  const userId = currentUserId();
  const [accounts, recent] = await withDb(async (sql) => Promise.all([
    listAccounts(sql, userId, { roles: ["asset", "liability", "expense", "income"] }),
    listRecentTransactions(sql, userId),
  ]));
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Log a transaction</h1>
      <p className="mt-1 text-sm text-slate-400">A quick record now keeps your spending view useful later.</p>
      <div className="mt-6"><CaptureForm accounts={accounts} today={manilaToday()} initialDirection={direction} /></div>
      <section className="mt-10">
        <h2 className="text-lg font-medium">Recent transactions</h2>
        {recent.length === 0 ? <p className="mt-3 text-sm text-slate-400">Nothing logged yet.</p> : (
          <ul className="mt-3 divide-y divide-slate-800 border-y border-slate-800">
            {recent.map((transaction) => <li key={transaction.id} className="grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1 py-3 text-sm">
              <time className="text-slate-500">{transaction.occurredAt}</time>
              <span className="font-medium">{transaction.payee ?? "—"}</span>
              <span className="tabular-nums text-slate-100">{formatPeso(transaction.amountMinor)}</span>
              <span className="col-start-2 text-slate-400">{transaction.category} · {transaction.account}</span>
            </li>)}
          </ul>
        )}
      </section>
    </main>
  );
}
