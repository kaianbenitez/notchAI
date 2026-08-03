import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import {
  AccountError,
  archiveAccount,
  createAccount,
  createCategory,
  deleteAccount,
  getAccount,
  listAccounts,
  unarchiveAccount,
  updateAccount,
} from "../src/accounts/repo.js";
import { postTransaction } from "../src/ledger/post.js";

const SCHEMA = readFileSync(
  fileURLToPath(new URL("../db/schema.sql", import.meta.url)),
  "utf8",
);

const USER = "00000000-0000-0000-0000-000000000001";
const OTHER_USER = "00000000-0000-0000-0000-000000000002";

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
});

describe("creating accounts", () => {
  it("creates a wallet and a category in the same table", async () => {
    const gcash = await createAccount(db, {
      userId: USER,
      name: "GCash",
      role: "asset",
      kind: "ewallet",
    });
    const dining = await createCategory(db, { userId: USER, name: "Dining" });

    expect(gcash.role).toBe("asset");
    expect(dining.role).toBe("expense");
    expect(dining.kind).toBe("category");
    expect(dining.currency).toBe("PHP");
  });

  it("tidies the name it was given", async () => {
    const account = await createCategory(db, { userId: USER, name: "  Fuel   money " });
    expect(account.name).toBe("Fuel money");
  });

  it("refuses a blank name", async () => {
    await expect(createCategory(db, { userId: USER, name: "   " })).rejects.toThrow(
      /needs a name/,
    );
  });

  it("refuses a kind that makes no sense for the role", async () => {
    await expect(
      createAccount(db, {
        userId: USER,
        name: "Nonsense",
        role: "expense",
        kind: "credit_card",
      }),
    ).rejects.toThrow(AccountError);
  });

  it("refuses a second live category with the same name", async () => {
    await createCategory(db, { userId: USER, name: "Groceries" });
    await expect(
      createCategory(db, { userId: USER, name: "groceries" }),
    ).rejects.toThrow(/already have/);
  });

  it("lets an expense and an income category share a name", async () => {
    await createCategory(db, { userId: USER, name: "Gifts", role: "expense" });
    const income = await createCategory(db, {
      userId: USER,
      name: "Gifts",
      role: "income",
    });
    expect(income.role).toBe("income");
  });

  it("frees the name again once the old one is archived", async () => {
    const old = await createCategory(db, { userId: USER, name: "Transport" });
    await archiveAccount(db, USER, old.id);
    const fresh = await createCategory(db, { userId: USER, name: "Transport" });
    expect(fresh.id).not.toBe(old.id);
  });
});

describe("category hierarchy", () => {
  it("nests a category under a parent of the same role", async () => {
    const food = await createCategory(db, { userId: USER, name: "Food" });
    const groceries = await createCategory(db, {
      userId: USER,
      name: "Groceries",
      parentId: food.id,
    });
    expect(groceries.parentId).toBe(food.id);
  });

  it("refuses a parent of a different role", async () => {
    const income = await createCategory(db, {
      userId: USER,
      name: "Salary",
      role: "income",
    });
    await expect(
      createCategory(db, { userId: USER, name: "Snacks", parentId: income.id }),
    ).rejects.toThrow(/cannot sit under it/);
  });

  it("refuses a cycle", async () => {
    const food = await createCategory(db, { userId: USER, name: "Food" });
    const groceries = await createCategory(db, {
      userId: USER,
      name: "Groceries",
      parentId: food.id,
    });

    await expect(
      updateAccount(db, USER, food.id, { parentId: groceries.id }),
    ).rejects.toThrow(/underneath itself/);
    await expect(
      updateAccount(db, USER, food.id, { parentId: food.id }),
    ).rejects.toThrow(/its own parent/);
  });

  it("lists parents immediately before their children", async () => {
    const food = await createCategory(db, { userId: USER, name: "Food" });
    await createCategory(db, { userId: USER, name: "Transport" });
    await createCategory(db, { userId: USER, name: "Groceries", parentId: food.id });
    await createCategory(db, { userId: USER, name: "Dining", parentId: food.id });

    const names = (await listAccounts(db, USER, { roles: ["expense"] })).map(
      (a) => a.name,
    );
    expect(names).toEqual(["Food", "Dining", "Groceries", "Transport"]);
  });
});

describe("listing", () => {
  it("reports balances from the ledger", async () => {
    const gcash = await createAccount(db, {
      userId: USER,
      name: "GCash",
      role: "asset",
      kind: "ewallet",
    });
    const card = await createAccount(db, {
      userId: USER,
      name: "BPI Card",
      role: "liability",
      kind: "credit_card",
    });
    const dining = await createCategory(db, { userId: USER, name: "Dining" });

    await postTransaction(db, { userId: USER, occurredAt: "2026-08-01" }, [
      { accountId: card.id, amountMinor: -100000 },
      { accountId: dining.id, amountMinor: 100000 },
    ]);

    const byId = new Map(
      (await listAccounts(db, USER)).map((a) => [a.id, a] as const),
    );

    expect(byId.get(gcash.id)!.balanceMinor).toBe(0);
    expect(byId.get(card.id)!.balanceMinor).toBe(-100000);
    // A card you owe ₱1,000 on displays as +1,000 owed, not -1,000.
    expect(byId.get(card.id)!.displayBalanceMinor).toBe(100000);
    expect(byId.get(dining.id)!.balanceMinor).toBe(100000);
  });

  it("hides archived accounts unless asked", async () => {
    const old = await createCategory(db, { userId: USER, name: "Old thing" });
    await archiveAccount(db, USER, old.id);

    expect(await listAccounts(db, USER)).toHaveLength(0);
    expect(await listAccounts(db, USER, { includeArchived: true })).toHaveLength(1);
  });

  it("filters by role and kind", async () => {
    await createAccount(db, {
      userId: USER,
      name: "Cash",
      role: "asset",
      kind: "cash",
    });
    await createCategory(db, { userId: USER, name: "Dining" });

    expect(await listAccounts(db, USER, { roles: ["expense"] })).toHaveLength(1);
    expect(await listAccounts(db, USER, { kinds: ["cash"] })).toHaveLength(1);
    expect(
      await listAccounts(db, USER, { roles: ["asset", "expense"] }),
    ).toHaveLength(2);
  });

  it("never shows another user's accounts", async () => {
    await createCategory(db, { userId: OTHER_USER, name: "Theirs" });
    expect(await listAccounts(db, USER)).toHaveLength(0);
    const theirs = await listAccounts(db, OTHER_USER);
    expect(await getAccount(db, USER, theirs[0].id)).toBeNull();
  });
});

describe("editing", () => {
  it("renames", async () => {
    const account = await createCategory(db, { userId: USER, name: "Dinning" });
    const fixed = await updateAccount(db, USER, account.id, { name: "Dining" });
    expect(fixed.name).toBe("Dining");
  });

  it("refuses a rename onto a name already in use", async () => {
    await createCategory(db, { userId: USER, name: "Dining" });
    const other = await createCategory(db, { userId: USER, name: "Groceries" });
    await expect(
      updateAccount(db, USER, other.id, { name: "Dining" }),
    ).rejects.toThrow(/already have/);
  });

  it("allows a rename that only changes capitalisation", async () => {
    const account = await createCategory(db, { userId: USER, name: "dining" });
    const fixed = await updateAccount(db, USER, account.id, { name: "Dining" });
    expect(fixed.name).toBe("Dining");
  });

  it("moves a category to the top level", async () => {
    const food = await createCategory(db, { userId: USER, name: "Food" });
    const groceries = await createCategory(db, {
      userId: USER,
      name: "Groceries",
      parentId: food.id,
    });
    const moved = await updateAccount(db, USER, groceries.id, { parentId: null });
    expect(moved.parentId).toBeNull();
  });
});

describe("archiving and deleting", () => {
  it("archives and restores without touching the balance", async () => {
    const card = await createAccount(db, {
      userId: USER,
      name: "BPI Card",
      role: "liability",
      kind: "credit_card",
    });
    const dining = await createCategory(db, { userId: USER, name: "Dining" });
    await postTransaction(db, { userId: USER, occurredAt: "2026-08-01" }, [
      { accountId: card.id, amountMinor: -50000 },
      { accountId: dining.id, amountMinor: 50000 },
    ]);

    await archiveAccount(db, USER, dining.id);
    const archived = await getAccount(db, USER, dining.id);
    expect(archived!.archivedAt).toBeInstanceOf(Date);
    expect(archived!.balanceMinor).toBe(50000);

    const restored = await unarchiveAccount(db, USER, dining.id);
    expect(restored.archivedAt).toBeNull();
  });

  it("refuses to archive a parent that still has live children", async () => {
    const food = await createCategory(db, { userId: USER, name: "Food" });
    await createCategory(db, { userId: USER, name: "Groceries", parentId: food.id });
    await expect(archiveAccount(db, USER, food.id)).rejects.toThrow(
      /sub-accounts/,
    );
  });

  it("deletes an account that was never used", async () => {
    const account = await createCategory(db, { userId: USER, name: "Mistake" });
    await deleteAccount(db, USER, account.id);
    expect(await getAccount(db, USER, account.id)).toBeNull();
  });

  it("refuses to delete an account with entries against it", async () => {
    const card = await createAccount(db, {
      userId: USER,
      name: "BPI Card",
      role: "liability",
      kind: "credit_card",
    });
    const dining = await createCategory(db, { userId: USER, name: "Dining" });
    await postTransaction(db, { userId: USER, occurredAt: "2026-08-01" }, [
      { accountId: card.id, amountMinor: -50000 },
      { accountId: dining.id, amountMinor: 50000 },
    ]);

    await expect(deleteAccount(db, USER, dining.id)).rejects.toThrow(
      /archive it instead/,
    );
    expect(await getAccount(db, USER, dining.id)).not.toBeNull();
  });
});
