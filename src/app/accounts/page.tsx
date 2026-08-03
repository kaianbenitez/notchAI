import { listAccounts } from "../../accounts/repo";
import { currentUserId } from "../../auth";
import { AccountManager, type TypeOption } from "../../components/AccountManager";
import { withDb } from "../../db/client";

// Reads the ledger on every request; there is nothing to prerender at build time.
export const dynamic = "force-dynamic";

/**
 * Receivables and payables are deliberately absent: those are created by adding
 * a person (M2), not by hand, so that the account and the person stay linked.
 */
const TYPES: TypeOption[] = [
  { value: "asset:ewallet", label: "E-wallet" },
  { value: "asset:bank", label: "Bank account" },
  { value: "asset:cash", label: "Cash" },
  { value: "liability:credit_card", label: "Credit card" },
  { value: "asset:brokerage", label: "Brokerage" },
];

export default async function AccountsPage() {
  const accounts = await withDb((sql) =>
    listAccounts(sql, currentUserId(), {
      roles: ["asset", "liability", "equity"],
      includeArchived: true,
    }),
  );

  return (
    <AccountManager
      title="Accounts"
      blurb="Where your money sits. Balances come straight from the ledger — a card you owe on shows what you owe."
      accounts={accounts}
      typeOptions={TYPES}
      emptyMessage="No accounts yet. Add the wallet or card you spend from most."
    />
  );
}
