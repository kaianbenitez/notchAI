import { listAccounts } from "../../accounts/repo";
import { currentUserId } from "../../auth";
import { CaptureForm } from "../../components/CaptureForm";
import { withDb } from "../../db/client";
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
      <div className="mt-6"><CaptureForm accounts={accounts} today={manilaToday()} initialDirection={direction} recent={recent} /></div>
    </main>
  );
}
