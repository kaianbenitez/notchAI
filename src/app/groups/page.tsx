import { currentUserId } from "../../auth";
import { GroupManager } from "../../components/GroupManager";
import { withDb } from "../../db/client";
import { listGroupMembers, listGroups } from "../../groups/repo";
import { listPeople } from "../../people/repo";

export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const userId = currentUserId();
  const [groups, people, members] = await withDb(async (sql) => {
    const [groups, people] = await Promise.all([
      listGroups(sql, userId, { includeArchived: true }),
      listPeople(sql, userId),
    ]);
    const members = await Promise.all(groups.map(async (group) => [group.id, await listGroupMembers(sql, userId, group.id)] as const));
    return [groups, people, Object.fromEntries(members)] as const;
  });
  return <GroupManager groups={groups} people={people} membersByGroup={members} />;
}
