import { describe, expect, it } from "vitest";

import { OfflineCaptureQueue, PermanentCaptureError, type CaptureQueueStorage, type QueuedCapture } from "../src/transactions/offline-queue";

class MemoryStorage implements CaptureQueueStorage {
  captures: QueuedCapture[] = [];
  async list() { return [...this.captures]; }
  async put(capture: QueuedCapture) { this.captures = [...this.captures.filter((item) => item.id !== capture.id), capture]; }
  async remove(id: string) { this.captures = this.captures.filter((capture) => capture.id !== id); }
}

function capture(id: string, queuedAt = "2026-08-03T00:00:00.000Z"): QueuedCapture {
  return { id, queuedAt, direction: "out", occurredAt: "2026-08-03", payee: "Lunch", amount: "100", categoryId: "category", accountId: "cash", memo: "" };
}

describe("offline capture queue", () => {
  it("queues an entry when sending fails", async () => {
    const storage = new MemoryStorage();
    const result = await new OfflineCaptureQueue(storage).sendOrQueue(capture("one"), async () => { throw new Error("offline"); });
    expect(result).toBe("queued");
    expect(storage.captures.map((item) => item.id)).toEqual(["one"]);
  });

  it("does not queue a successful send", async () => {
    const storage = new MemoryStorage();
    const result = await new OfflineCaptureQueue(storage).sendOrQueue(capture("one"), async () => {});
    expect(result).toBe("sent");
    expect(storage.captures).toEqual([]);
  });

  it("flushes oldest captures first", async () => {
    const storage = new MemoryStorage();
    await storage.put(capture("new", "2026-08-03T00:00:02.000Z"));
    await storage.put(capture("old", "2026-08-03T00:00:01.000Z"));
    const sent: string[] = [];
    await new OfflineCaptureQueue(storage).flush(async (item) => { sent.push(item.id); });
    expect(sent).toEqual(["old", "new"]);
    expect(storage.captures).toEqual([]);
  });

  it("keeps a failed flush queued and retries it later", async () => {
    const storage = new MemoryStorage();
    await storage.put(capture("one"));
    const queue = new OfflineCaptureQueue(storage);
    expect(await queue.flush(async () => { throw new Error("still offline"); })).toEqual({ sent: [], failed: true, rejected: [] });
    expect(storage.captures.map((item) => item.id)).toEqual(["one"]);
    await queue.flush(async () => {});
    expect(storage.captures).toEqual([]);
  });

  it("does nothing when the queue is empty", async () => {
    const result = await new OfflineCaptureQueue(new MemoryStorage()).flush(async () => { throw new Error("should not send"); });
    expect(result).toEqual({ sent: [], failed: false, rejected: [] });
  });

  it("removes permanent rejections and continues flushing later captures", async () => {
    const storage = new MemoryStorage();
    await storage.put(capture("rejected", "2026-08-03T00:00:01.000Z"));
    await storage.put(capture("later", "2026-08-03T00:00:02.000Z"));
    const sent: string[] = [];

    const result = await new OfflineCaptureQueue(storage).flush(async (item) => {
      if (item.id === "rejected") throw new PermanentCaptureError("category is archived");
      sent.push(item.id);
    });

    expect(result).toEqual({ sent: ["later"], failed: false, rejected: [{ id: "rejected", reason: "category is archived" }] });
    expect(sent).toEqual(["later"]);
    expect(storage.captures).toEqual([]);
  });

  it("leaves a transient failure and later captures queued", async () => {
    const storage = new MemoryStorage();
    await storage.put(capture("failed", "2026-08-03T00:00:01.000Z"));
    await storage.put(capture("later", "2026-08-03T00:00:02.000Z"));

    const result = await new OfflineCaptureQueue(storage).flush(async (item) => {
      if (item.id === "failed") throw new Error("still offline");
    });

    expect(result).toEqual({ sent: [], failed: true, rejected: [] });
    expect(storage.captures.map((item) => item.id)).toEqual(["failed", "later"]);
  });

  it("reports permanent rejections before a transient failure", async () => {
    const storage = new MemoryStorage();
    await storage.put(capture("rejected", "2026-08-03T00:00:01.000Z"));
    await storage.put(capture("failed", "2026-08-03T00:00:02.000Z"));
    await storage.put(capture("later", "2026-08-03T00:00:03.000Z"));

    const result = await new OfflineCaptureQueue(storage).flush(async (item) => {
      if (item.id === "rejected") throw new PermanentCaptureError("category is archived");
      if (item.id === "failed") throw new Error("still offline");
    });

    expect(result).toEqual({ sent: [], failed: true, rejected: [{ id: "rejected", reason: "category is archived" }] });
    expect(storage.captures.map((item) => item.id)).toEqual(["failed", "later"]);
  });
});
