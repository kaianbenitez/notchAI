import { listAccounts } from "../../accounts/repo";
import { currentUserId } from "../../auth";
import { SplitForm } from "../../components/SplitForm";
import { withDb } from "../../db/client";
import { listPeople } from "../../people/repo";

export const dynamic = "force-dynamic";

function manilaToday(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export default async function SplitPage() {
  const userId = currentUserId();
  const [people, categories, accounts] = await withDb((sql) => Promise.all([listPeople(sql, userId), listAccounts(sql, userId, { roles: ["expense"] }), listAccounts(sql, userId, { roles: ["asset", "liability"] })]));
  return <main className="mx-auto w-full max-w-3xl px-6 py-10"><h1 className="text-2xl font-semibold tracking-tight">Split a bill</h1><p className="mt-1 text-sm text-slate-400">Record your share and what friends owe each other.</p><div className="mt-6">{people.length === 0 ? <p className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-500">Add a friend on the <a href="/friends" className="text-emerald-400 underline underline-offset-4">Friends page</a> before splitting a bill.</p> : <SplitForm people={people} categories={categories} accounts={accounts.filter((account) => account.kind !== "category")} today={manilaToday()} />}</div></main>;
}
