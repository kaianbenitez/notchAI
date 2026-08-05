import { listAccounts } from "../../accounts/repo";
import { currentUserId } from "../../auth";
import { BillManager } from "../../components/BillManager";
import { withDb } from "../../db/client";
import { listReminderRules } from "../../reminders/repo";
import { detectRecurringBillCandidates } from "../../reminders/candidates";

export const dynamic = "force-dynamic";

function manilaToday(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export default async function BillsPage() {
  const userId = currentUserId();
  const [rules, accounts, categories, candidates] = await withDb((sql) => Promise.all([
    listReminderRules(sql, userId, { includeArchived: true }), listAccounts(sql, userId, { roles: ["asset", "liability"] }), listAccounts(sql, userId, { roles: ["expense"] }), detectRecurringBillCandidates(sql, userId),
  ]));
  return <BillManager rules={rules} accounts={accounts} categories={categories} candidates={candidates} today={manilaToday()} />;
}
