import { listAccounts } from "../../accounts/repo";
import { currentUserId } from "../../auth";
import { withDb } from "../../db/client";
import { ImportReview } from "./ImportReview";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const userId = currentUserId();
  const [accounts, categories] = await withDb((sql) => Promise.all([
    listAccounts(sql, userId, { roles: ["liability"], kinds: ["credit_card"] }),
    listAccounts(sql, userId, { roles: ["expense"], kinds: ["category"] }),
  ]));
  return <main className="mx-auto w-full max-w-3xl px-6 py-10">
    <h1 className="text-2xl font-semibold tracking-tight">Import statement</h1>
    <p className="mt-1 text-sm text-slate-400">Extract a card statement, review every proposed reconciliation, then commit only the rows you approve.</p>
    <div className="mt-6"><ImportReview accounts={accounts.map(({ id, name }) => ({ id, name }))} categories={categories.map(({ id, name }) => ({ id, name }))} /></div>
  </main>;
}
