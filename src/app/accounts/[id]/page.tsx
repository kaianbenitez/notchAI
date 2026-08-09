import { notFound } from "next/navigation";

import { getAccount, listAccounts } from "../../../accounts/repo";
import { currentUserId } from "../../../auth";
import { CreditCardProfile } from "../../../components/CreditCardProfile";
import { currentStatementPeriod, getCreditCardCutoff, listCreditCardActivity, listCreditCardStatements } from "../../../credit-cards/repo";
import { withDb } from "../../../db/client";

export const dynamic = "force-dynamic";

function manilaToday(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export default async function CreditCardAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = currentUserId(); const { id } = await params; const today = manilaToday();
  const data = await withDb(async (sql) => {
    const card = await getAccount(sql, userId, id);
    if (!card || card.role !== "liability" || card.kind !== "credit_card") return null;
    const [fundingAccounts, cutoffDay, statements] = await Promise.all([
      listAccounts(sql, userId, { roles: ["asset"] }), getCreditCardCutoff(sql, userId, id), listCreditCardStatements(sql, userId, id),
    ]);
    const active = statements.find((statement) => statement.status === "active");
    const period = active ?? (cutoffDay === null ? null : currentStatementPeriod(today, cutoffDay));
    const activity = period ? await listCreditCardActivity(sql, userId, id, period.periodStartsOn, period.periodEndsOn) : [];
    return { card, fundingAccounts, cutoffDay, statements, activity };
  });
  if (!data) notFound();
  return <CreditCardProfile {...data} today={today} />;
}
