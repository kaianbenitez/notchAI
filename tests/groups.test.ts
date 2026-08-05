import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, expect, it } from "vitest";
import { createPerson } from "../src/people/repo";
import {
  addGroupMember,
  archiveGroup,
  createGroup,
  listGroups,
  listGroupMembers,
} from "../src/groups/repo";
const S = readFileSync(
    fileURLToPath(new URL("../db/schema.sql", import.meta.url)),
    "utf8",
  ),
  U = "00000000-0000-0000-0000-000000000001",
  O = "00000000-0000-0000-0000-000000000002";
let db: PGlite;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(S);
});

it("lists live groups and excludes archived groups", async () => {
  const live = await createGroup(db, { userId: U, name: "Live" });
  const archived = await createGroup(db, { userId: U, name: "Archived" });
  await archiveGroup(db, U, archived.id);
  expect((await listGroups(db, U)).map((group) => group.id)).toEqual([live.id]);
  expect(
    (await listGroups(db, U, { includeArchived: true })).map(
      (group) => group.id,
    ),
  ).toEqual([archived.id, live.id]);
});
it("owns membership and rejects duplicates", async () => {
  const g = await createGroup(db, { userId: U, name: "Trip" }),
    p = await createPerson(db, { userId: U, name: "Ana" });
  await addGroupMember(db, U, g.id, p.id);
  expect((await listGroupMembers(db, U, g.id))[0].name).toBe("Ana");
  await expect(addGroupMember(db, U, g.id, p.id)).rejects.toThrow(/already/);
  const foreign = await createPerson(db, { userId: O, name: "Bea" });
  await expect(addGroupMember(db, U, g.id, foreign.id)).rejects.toThrow(
    /person/,
  );
});
