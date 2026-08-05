import { listAccounts } from "../../accounts/repo";
import { currentUserId } from "../../auth";
import { FriendManager } from "../../components/FriendManager";
import { withDb } from "../../db/client";
import { listPeople, listRecentFriendActivity } from "../../people/repo";

export const dynamic = "force-dynamic";

export default async function FriendsPage() {
  const userId = currentUserId();
  const [people, assets, activity] = await withDb((sql) => Promise.all([
    listPeople(sql, userId, { includeArchived: true }),
    listAccounts(sql, userId, { roles: ["asset"], includeArchived: true }),
    listRecentFriendActivity(sql, userId, { limit: 20 }),
  ]));
  const accounts = assets.filter((account) => account.archivedAt === null && account.kind !== "category" && account.kind !== "receivable" && account.kind !== "payable");
  const archivedFriendIds = new Set(assets.filter((account) => account.archivedAt !== null).map((account) => account.personId).filter((id): id is string => id !== null));
  return <FriendManager people={people} accounts={accounts} archivedFriendIds={[...archivedFriendIds]} activity={activity} />;
}
