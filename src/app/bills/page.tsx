import { listAccounts } from "../../accounts/repo";
import { currentUserId } from "../../auth";
import { BillManager } from "../../components/BillManager";
import { withDb } from "../../db/client";
import { detectRecurringBills } from "../../reminders/detect";
import { listReminderRules } from "../../reminders/repo";

export const dynamic = "force-dynamic";

function manilaToday(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export default async function BillsPage() {
  const userId = currentUserId();
  const today = manilaToday();
  const [rules, accounts, categories, detected] = await withDb((sql) => Promise.all([
    listReminderRules(sql, userId, { includeArchived: true }), listAccounts(sql, userId, { roles: ["asset", "liability"] }), listAccounts(sql, userId, { roles: ["expense"] }),
    detectRecurringBills(sql, userId, today),
  ]));
  return <BillManager rules={rules} accounts={accounts} categories={categories} detected={detected} today={today} />;
}
