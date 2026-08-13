import { notFound } from "next/navigation";

import { listAccounts } from "../../../../accounts/repo";
import { currentUserId } from "../../../../auth";
import { EditTransactionForm } from "../../../../components/EditTransactionForm";
import { withDb } from "../../../../db/client";
import { EditError, getEditableTransaction } from "../../../../transactions/edit";

export const dynamic = "force-dynamic";

export default async function EditTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = currentUserId();

  let transaction;
  try {
    const [loaded] = await withDb((sql) => Promise.all([
      getEditableTransaction(sql, userId, id),
    ]));
    transaction = loaded;
  } catch (error) {
    if (error instanceof EditError) notFound();
    throw error;
  }

  const accounts = await withDb((sql) => listAccounts(sql, userId, { roles: ["asset", "liability", "expense", "income"] }));

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Edit transaction</h1>
      <p className="mt-1 text-sm text-slate-400">Fix the date, payee, category, account, or memo.</p>
      <div className="mt-6"><EditTransactionForm transaction={transaction} accounts={accounts} /></div>
    </main>
  );
}
