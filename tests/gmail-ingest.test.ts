import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccount, createCategory } from "../src/accounts/repo";
import { ingestGmailMessage, listGmailReviewItems, resolveGmailReviewItem } from "../src/ingest/gmail/repo";
import { dispatchGmail, type GmailMessage } from "../src/ingest/gmail/parsers";

const schema = readFileSync(fileURLToPath(new URL("../db/schema.sql", import.meta.url)), "utf8");
const userId = "00000000-0000-0000-0000-000000000001";
let db: PGlite;
beforeEach(async () => { db = new PGlite(); await db.exec(schema); });

const bpiBill: GmailMessage = { id: "synthetic-bpi-bill-1", from: "BPI Online <onlinebanking@bpi.com.ph>", subject: "Bills Payment Confirmation to Synthetic Telecom", body: `<table><tr><td>Confirmation Number</td><td>SYN-100</td></tr><tr><td>Transaction Date and Time</td><td>Thursday, Dec 17 2026; 06:41:29 AM (GMT +8)</td></tr><tr><td>Pay From</td><td>545512XXXXXX9999 (Synthetic Rewards)</td></tr><tr><td>Pay To</td><td>Synthetic Telecom</td></tr><tr><td>Amount</td><td>PHP 1,537.42</td></tr></table>` };
const bpiTransfer: GmailMessage = { id: "synthetic-bpi-transfer-1", from: "onlinebanking@bpi.com.ph", subject: "Interbank Funds Transfer Confirmation", body: `<table><tr><td>Confirmation Number</td><td>SYN-200</td></tr><tr><td>Transaction Date and Time</td><td>Tuesday, Dec 15 2026; 07:43:18 AM (GMT +8)</td></tr><tr><td>Transfer From</td><td>XXXX-XXXX-999 (Synthetic Payroll)</td></tr><tr><td>Transfer To</td><td>Synthetic Recipient</td></tr><tr><td>Transfer Amount</td><td>PHP 2,841.37</td></tr></table>` };
const mari: GmailMessage = { id: "synthetic-mari-1", from: "MariBank PH Alerts <alerts@maribank.com.ph>", subject: "MariBank Transfer Notification", body: "Dear Synthetic Name,<br>You have received a funds transfer to your account.<br>Transaction time: 03 Aug 2026 22:17<br>Transfer from: Synthetic Employer - XXXX1234<br>Transfer to: Synthetic Name - 8888<br>Transfer amount: PHP 3,500.25<br>Reference No: SYN-MARI-1" };

describe("Gmail transaction templates", () => {
  it("parses synthetic BPI and MariBank templates without floats", () => {
    expect(dispatchGmail(bpiBill)).toMatchObject({ occurredAt: "2026-12-17", payee: "Synthetic Telecom", amountMinor: 153742, direction: "out", sourceRef: "bpi-bill:SYN-100" });
    expect(dispatchGmail(bpiTransfer)).toMatchObject({ occurredAt: "2026-12-15", amountMinor: 284137, direction: "out", payee: "Synthetic Recipient" });
    expect(dispatchGmail(mari)).toMatchObject({ occurredAt: "2026-08-03", amountMinor: 350025, direction: "in", payee: "Synthetic Employer - XXXX1234" });
  });
  it("retains unsupported allowlisted mail raw and never guesses a transaction", async () => {
    expect(await ingestGmailMessage(db, userId, { id: "unknown", from: "BPI InstaPay <bpiinstapay@bpi.com.ph>", subject: "Anything", body: "synthetic" })).toBe("unrecognized");
    expect(await db.query("select status from gmail_ingest_items")).toMatchObject({ rows: [{ status: "unrecognized" }] });
    expect(await db.query("select count(*)::int as count from transactions")).toMatchObject({ rows: [{ count: 0 }] });
  });
  it("lists only recognized transactions awaiting review", async () => {
    await ingestGmailMessage(db, userId, { id: "unknown", from: "BPI InstaPay <bpiinstapay@bpi.com.ph>", subject: "Anything", body: "synthetic" });
    await ingestGmailMessage(db, userId, mari);
    expect(await listGmailReviewItems(db, userId)).toMatchObject([{ gmailMessageId: mari.id, status: "pending_review" }]);
  });
  it("queues first sighting, remembers aliases, then auto-posts a MariBank credit", async () => {
    const bank = await createAccount(db, { userId, name: "Synthetic MariBank", role: "asset", kind: "bank" });
    const income = await createCategory(db, { userId, name: "Synthetic Income", role: "income" });
    expect(await ingestGmailMessage(db, userId, mari)).toBe("pending_review");
    const queued = await db.query<{ id: string }>("select id from gmail_ingest_items where gmail_message_id = $1", [mari.id]);
    await resolveGmailReviewItem(db, userId, queued.rows[0].id, bank.id, income.id);
    expect(await db.query("select amount_minor from entries order by amount_minor")).toMatchObject({ rows: [{ amount_minor: -350025 }, { amount_minor: 350025 }] });
    expect(await ingestGmailMessage(db, userId, { ...mari, id: "synthetic-mari-2", body: mari.body.replace("SYN-MARI-1", "SYN-MARI-2") })).toBe("posted");
  });
  it("posts resolved BPI bill-pay and InstaPay debits through the ledger front door", async () => {
    const card = await createAccount(db, { userId, name: "Synthetic Card", role: "liability", kind: "credit_card" });
    const bank = await createAccount(db, { userId, name: "Synthetic BPI", role: "asset", kind: "bank" });
    const expense = await createCategory(db, { userId, name: "Synthetic Bills", role: "expense" });
    for (const [message, account] of [[bpiBill, card], [bpiTransfer, bank]] as const) {
      await ingestGmailMessage(db, userId, message);
      const queued = await db.query<{ id: string }>("select id from gmail_ingest_items where gmail_message_id = $1", [message.id]);
      await resolveGmailReviewItem(db, userId, queued.rows[0].id, account.id, expense.id);
    }
    expect(await db.query("select source, ingest_event_id from transactions order by occurred_at")).toMatchObject({ rows: [{ source: "email", ingest_event_id: expect.any(String) }, { source: "email", ingest_event_id: expect.any(String) }] });
  });
  it("makes the same Gmail message replay-safe", async () => {
    await ingestGmailMessage(db, userId, bpiBill);
    expect(await ingestGmailMessage(db, userId, bpiBill)).toBe("duplicate");
    expect(await db.query("select count(*)::int as count from gmail_ingest_items")).toMatchObject({ rows: [{ count: 1 }] });
  });
});
