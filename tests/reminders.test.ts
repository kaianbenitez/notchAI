import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAccount, createCategory } from "../src/accounts/repo";
import { postTransaction } from "../src/ledger/post";
import { reconcileDueRules, runDailyReminders } from "../src/reminders/cron";
import { runDailyCaptureNudge } from "../src/capture/nudge";
import { detectRecurringBillCandidates, dismissRecurringBillCandidate } from "../src/reminders/candidates";
import { GET as captureNudgeCron } from "../src/app/api/cron/capture-nudge/route";
import { rungForDate } from "../src/reminders/ladder";
import { sendTelegramMessage } from "../src/notifications/telegram";
import { nextOccurrence } from "../src/reminders/recurrence";
import { createReminderRule, markReminderRulePaid } from "../src/reminders/repo";

const SCHEMA = readFileSync(fileURLToPath(new URL("../db/schema.sql", import.meta.url)), "utf8");
const USER = "00000000-0000-0000-0000-000000000001";
let db: PGlite;
let accountId: string;
let categoryId: string;

beforeEach(async () => {
  db = new PGlite(); await db.exec(SCHEMA);
  accountId = (await createAccount(db, { userId: USER, name: "Bank", role: "asset", kind: "bank" })).id;
  categoryId = (await createCategory(db, { userId: USER, name: "Utilities" })).id;
});

describe("recurrence", () => {
  it("returns the next monthly, weekly, and biweekly occurrence", () => {
    expect(nextOccurrence("FREQ=MONTHLY;BYMONTHDAY=5", "2026-12-05")).toBe("2027-01-05");
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=MO", "2026-08-03")).toBe("2026-08-10");
    expect(nextOccurrence("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR", "2026-08-07")).toBe("2026-08-21");
  });
});

describe("reminder ladder", () => {
  it("returns only the scheduled rung for a fixed today", () => {
    expect(rungForDate("2026-08-10", "2026-08-05")).toBe("t_minus_5");
    expect(rungForDate("2026-08-06", "2026-08-05")).toBe("t_minus_1");
    expect(rungForDate("2026-08-05", "2026-08-05")).toBe("due");
    expect(rungForDate("2026-08-04", "2026-08-05")).toBe("overdue");
    expect(rungForDate("2026-08-09", "2026-08-05")).toBeNull();
  });
});

describe("reminder rule lifecycle", () => {
  it("materializes a rung only once and sends only once when cron runs twice", async () => {
    await createReminderRule(db, { userId: USER, name: "Internet", amountMinor: 1_799_00, accountId, categoryId, recurrencePreset: "monthly:10", nextDueOn: "2026-08-10" });
    const send = vi.fn(async () => undefined);
    await runDailyReminders(db, "2026-08-05", send);
    await runDailyReminders(db, "2026-08-05", send);
    expect((await db.query("select id, sent_at from reminders")).rows).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("acknowledges the current cycle and advances the due date", async () => {
    const rule = await createReminderRule(db, { userId: USER, name: "Internet", amountMinor: 1_799_00, accountId, categoryId, recurrencePreset: "monthly:10", nextDueOn: "2026-08-10" });
    await db.query("insert into reminders (rule_id, cycle_due_on, rung, fire_at) values ($1, '2026-08-10', 't_minus_5', '2026-08-05')", [rule.id]);
    await markReminderRulePaid(db, USER, rule.id);
    expect((await db.query<{ acknowledged_at: Date | null }>("select acknowledged_at from reminders where rule_id = $1", [rule.id])).rows[0].acknowledged_at).not.toBeNull();
    const nextDue = (await db.query<{ next_due_on: string | Date }>("select next_due_on from recurring_rules where id = $1", [rule.id])).rows[0].next_due_on;
    expect(typeof nextDue === "string" ? nextDue : nextDue.toISOString()).toMatch(/^2026-09-10/);
  });

  it("rejects a monthly day outside 1 through 28", async () => {
    await expect(createReminderRule(db, { userId: USER, name: "Internet", amountMinor: 1_799_00, accountId, categoryId, recurrencePreset: "monthly:29", nextDueOn: "2026-08-29" })).rejects.toThrow(/supported monthly/);
  });
});

describe("bill auto-reconciliation", () => {
  async function rule(input: { amountMinor?: number; dueOn?: string; recurrencePreset?: string } = {}) {
    return createReminderRule(db, {
      userId: USER, name: "Internet", amountMinor: input.amountMinor ?? 100_000, accountId, categoryId,
      recurrencePreset: input.recurrencePreset ?? "monthly:10", nextDueOn: input.dueOn ?? "2026-08-10",
    });
  }

  async function expense(occurredAt: string, amountMinor: number, fundingAccountId = accountId): Promise<string> {
    return postTransaction(db, { userId: USER, occurredAt }, [
      { accountId: fundingAccountId, amountMinor: -amountMinor },
      { accountId: categoryId, amountMinor },
    ]);
  }

  it("closes the matching cycle, acknowledges its reminders, and records the transaction", async () => {
    const bill = await rule();
    await db.query("insert into reminders (rule_id, cycle_due_on, rung, fire_at) values ($1, '2026-08-10', 't_minus_5', '2026-08-05')", [bill.id]);
    const txnId = await expense("2026-08-08", 100_000);

    expect(await reconcileDueRules(db, "2026-08-08")).toBe(1);
    const reminder = (await db.query<{ acknowledged_at: Date | null }>("select acknowledged_at from reminders where rule_id = $1", [bill.id])).rows[0];
    expect(reminder.acknowledged_at).not.toBeNull();
    const updated = (await db.query<{ next_due_on: string | Date; last_matched_txn_id: string | null }>("select next_due_on, last_matched_txn_id from recurring_rules where id = $1", [bill.id])).rows[0];
    expect(typeof updated.next_due_on === "string" ? updated.next_due_on : updated.next_due_on.toISOString()).toMatch(/^2026-09-10/);
    expect(updated.last_matched_txn_id).toBe(txnId);
  });

  it("uses the earliest matching transaction, then its id as a deterministic tie-breaker", async () => {
    const bill = await rule();
    const later = await expense("2026-08-09", 100_000);
    const firstOnDate = await expense("2026-08-08", 100_000);
    const secondOnDate = await expense("2026-08-08", 100_000);

    await reconcileDueRules(db, "2026-08-09");
    const { last_matched_txn_id } = (await db.query<{ last_matched_txn_id: string | null }>("select last_matched_txn_id from recurring_rules where id = $1", [bill.id])).rows[0];
    expect(last_matched_txn_id).toBe([firstOnDate, secondOnDate].sort()[0]);
    expect(last_matched_txn_id).not.toBe(later);
  });

  it("respects integer percentage tolerance and rejects amounts beyond it", async () => {
    const within = await rule({ dueOn: "2026-08-10" });
    const outside = await rule({ dueOn: "2026-08-17", recurrencePreset: "monthly:17" });
    await db.query("update recurring_rules set tolerance_pct = 5 where id = any($1::uuid[])", [[within.id, outside.id]]);
    await expense("2026-08-08", 105_000);
    await expense("2026-08-15", 105_001);

    expect(await reconcileDueRules(db, "2026-08-15")).toBe(1);
    const rows = (await db.query<{ id: string; last_matched_txn_id: string | null }>("select id, last_matched_txn_id from recurring_rules where id = any($1::uuid[])", [[within.id, outside.id]])).rows;
    expect(rows.find((row) => row.id === within.id)?.last_matched_txn_id).not.toBeNull();
    expect(rows.find((row) => row.id === outside.id)?.last_matched_txn_id).toBeNull();
  });

  it("does not reconcile transactions outside the date window or with the wrong account or sign", async () => {
    const tooEarly = await rule({ dueOn: "2026-08-10" });
    const wrongAccount = await rule({ dueOn: "2026-08-17", recurrencePreset: "monthly:17" });
    const incoming = await rule({ dueOn: "2026-08-24", recurrencePreset: "monthly:24" });
    const otherAccountId = (await createAccount(db, { userId: USER, name: "Other bank", role: "asset", kind: "bank" })).id;
    await expense("2026-08-04", 100_000);
    await expense("2026-08-15", 100_000, otherAccountId);
    await postTransaction(db, { userId: USER, occurredAt: "2026-08-22" }, [
      { accountId, amountMinor: 100_000 },
      { accountId: categoryId, amountMinor: -100_000 },
    ]);

    expect(await reconcileDueRules(db, "2026-08-22")).toBe(0);
    const { rows } = await db.query<{ last_matched_txn_id: string | null }>("select last_matched_txn_id from recurring_rules where id = any($1::uuid[])", [[tooEarly.id, wrongAccount.id, incoming.id]]);
    expect(rows.every((row) => row.last_matched_txn_id === null)).toBe(true);
  });

  it("never reconciles archived rules", async () => {
    const bill = await rule();
    await db.query("update recurring_rules set archived_at = now() where id = $1", [bill.id]);
    await expense("2026-08-08", 100_000);

    expect(await reconcileDueRules(db, "2026-08-08")).toBe(0);
    const updated = (await db.query<{ next_due_on: string | Date; last_matched_txn_id: string | null }>("select next_due_on, last_matched_txn_id from recurring_rules where id = $1", [bill.id])).rows[0];
    expect(typeof updated.next_due_on === "string" ? updated.next_due_on : updated.next_due_on.toISOString()).toMatch(/^2026-08-10/);
    expect(updated.last_matched_txn_id).toBeNull();
  });

  it("closes a matched cycle only once when reconciliation runs twice", async () => {
    const bill = await rule({ dueOn: "2026-08-10", recurrencePreset: "weekly:MO" });
    await expense("2026-08-12", 100_000);

    expect(await reconcileDueRules(db, "2026-08-12")).toBe(1);
    expect(await reconcileDueRules(db, "2026-08-12")).toBe(0);
    const updated = (await db.query<{ next_due_on: string | Date }>("select next_due_on from recurring_rules where id = $1", [bill.id])).rows[0];
    expect(typeof updated.next_due_on === "string" ? updated.next_due_on : updated.next_due_on.toISOString()).toMatch(/^2026-08-17/);
  });

  it("clears the automatic-match marker when the user marks the next cycle paid manually", async () => {
    const bill = await rule();
    await expense("2026-08-08", 100_000);
    await reconcileDueRules(db, "2026-08-08");
    await markReminderRulePaid(db, USER, bill.id);

    const { last_matched_txn_id } = (await db.query<{ last_matched_txn_id: string | null }>("select last_matched_txn_id from recurring_rules where id = $1", [bill.id])).rows[0];
    expect(last_matched_txn_id).toBeNull();
  });
});

describe("Telegram delivery", () => {
  it("posts through fetch without contacting Telegram", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token"); vi.stubEnv("TELEGRAM_CHAT_ID", "1234");
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendTelegramMessage("Due today");
    expect(fetchMock).toHaveBeenCalledWith("https://api.telegram.org/bottest-token/sendMessage", expect.objectContaining({ method: "POST" }));
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
  });
});

describe("recurring bill suggestions", () => {
  async function recurringExpense(date: string, amount = 120_000, payee = "StreamFlix") {
    await postTransaction(db, { userId: USER, occurredAt: date, payee }, [
      { accountId, amountMinor: -amount }, { accountId: categoryId, amountMinor: amount },
    ]);
  }

  it("detects a consistent recurring expense and suggests its next cycle", async () => {
    await recurringExpense("2026-01-10"); await recurringExpense("2026-02-10", 123_000); await recurringExpense("2026-03-10", 119_000);
    const candidates = await detectRecurringBillCandidates(db, USER);
    expect(candidates).toEqual([expect.objectContaining({ name: "StreamFlix", amountMinor: 120_000, accountId, categoryId, recurrencePreset: "monthly:10", nextDueOn: "2026-04-10" })]);
  });

  it("does not suggest irregular or materially variable spending", async () => {
    await recurringExpense("2026-01-01", 100_000, "Corner shop"); await recurringExpense("2026-01-19", 160_000, "Corner shop"); await recurringExpense("2026-03-11", 90_000, "Corner shop");
    expect(await detectRecurringBillCandidates(db, USER)).toEqual([]);
  });

  it("excludes a pattern that already has an active rule", async () => {
    await recurringExpense("2026-01-10"); await recurringExpense("2026-02-10"); await recurringExpense("2026-03-10");
    await createReminderRule(db, { userId: USER, name: "StreamFlix", amountMinor: 120_000, accountId, categoryId, recurrencePreset: "monthly:10", nextDueOn: "2026-04-10" });
    expect(await detectRecurringBillCandidates(db, USER)).toEqual([]);
  });

  it("does not resurface a dismissed suggestion", async () => {
    await recurringExpense("2026-01-10"); await recurringExpense("2026-02-10"); await recurringExpense("2026-03-10");
    const [candidate] = await detectRecurringBillCandidates(db, USER);
    await dismissRecurringBillCandidate(db, USER, candidate.fingerprint);
    expect(await detectRecurringBillCandidates(db, USER)).toEqual([]);
  });
});

describe("evening capture nudge", () => {
  it("sends once when nothing has been logged today", async () => {
    const send = vi.fn(async () => undefined);
    expect(await runDailyCaptureNudge(db, "2026-08-05", send)).toBe(true);
    expect(await runDailyCaptureNudge(db, "2026-08-05", send)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not send when a transaction already exists today", async () => {
    await postTransaction(db, { userId: USER, occurredAt: "2026-08-05" }, [
      { accountId, amountMinor: -1_000 }, { accountId: categoryId, amountMinor: 1_000 },
    ]);
    const send = vi.fn(async () => undefined);
    expect(await runDailyCaptureNudge(db, "2026-08-05", send)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("capture-nudge cron authentication", () => {
  it("rejects a request without its bearer secret", async () => {
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    const response = await captureNudgeCron(new Request("https://notch.test/api/cron/capture-nudge"));
    expect(response.status).toBe(401);
    vi.unstubAllEnvs();
  });
});
