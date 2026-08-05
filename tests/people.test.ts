import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, expect, it } from "vitest";
import { createPerson, archivePerson, getPerson } from "../src/people/repo";
import { createAccount } from "../src/accounts/repo";
import { postTransaction } from "../src/ledger/post";
const S = readFileSync(
    fileURLToPath(new URL("../db/schema.sql", import.meta.url)),
    "utf8",
  ),
  U = "00000000-0000-0000-0000-000000000001";
let db: PGlite;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(S);
});
it("creates a receivable and only archives it at zero", async () => {
  const p = await createPerson(db, { userId: U, name: " Ana  Cruz " });
  expect(p.name).toBe("Ana Cruz");
  expect(
    await db.query("select role, kind from accounts where id = $1", [
      p.receivableAccountId,
    ]),
  ).toMatchObject({ rows: [{ role: "asset", kind: "receivable" }] });
  expect((await getPerson(db, U, p.id))!.balanceMinor).toBe(0);
  await archivePerson(db, U, p.id);
  await expect(
    createPerson(db, { userId: U, name: "Ana Cruz" }),
  ).resolves.toBeTruthy();
});

it("rejects a duplicate live name without regard to case", async () => {
  await createPerson(db, { userId: U, name: "Ana Cruz" });
  await expect(
    createPerson(db, { userId: U, name: "ana cruz" }),
  ).rejects.toThrow(/already/);
});
it("refuses to archive an unsettled person", async () => {
  const p = await createPerson(db, { userId: U, name: "Ana" });
  const cash = await createAccount(db, {
    userId: U,
    name: "Cash",
    role: "asset",
    kind: "cash",
  });
  await postTransaction(db, { userId: U, occurredAt: "2026-08-01" }, [
    { accountId: cash.id, amountMinor: -1 },
    { accountId: p.receivableAccountId, amountMinor: 1 },
  ]);
  await expect(archivePerson(db, U, p.id)).rejects.toThrow(/settle/);
});
