import { currentUserId } from "../../auth";
import { NetWorthManager } from "../../components/NetWorthManager";
import { withDb } from "../../db/client";
import { getSavingsGoalProgress, listCurrentBalances, listNetWorthLabels } from "../../net-worth/repo";

export const dynamic = "force-dynamic";

function manilaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function NetWorthPage() {
  const userId = currentUserId();
  const [balances, labels, goals] = await withDb((sql) => Promise.all([
    listCurrentBalances(sql, userId), listNetWorthLabels(sql, userId), getSavingsGoalProgress(sql, userId),
  ]));
  const totalMinor = balances.reduce((total, balance) => total + balance.balanceMinor, 0);
  return <NetWorthManager balances={balances} labels={labels} goals={goals} totalMinor={totalMinor} today={manilaToday()} />;
}
