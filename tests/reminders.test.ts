import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAccount, createCategory } from "../src/accounts/repo";
import { runDailyReminders } from "../src/reminders/cron";
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
