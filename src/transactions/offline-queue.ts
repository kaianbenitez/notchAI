/**
 * The durable part of manual capture's offline write-ahead queue.
 *
 * This deliberately knows nothing about IndexedDB. Browser code supplies a
 * storage adapter; tests use a small in-memory implementation instead.
 */

export interface QueuedCapture {
  /** Client-minted id, also sent to the ledger as transactions.source_ref. */
  id: string;
  queuedAt: string;
  direction: "out" | "in";
  occurredAt: string;
  payee: string;
  amount: string;
  categoryId: string;
  accountId: string;
  memo: string;
}

export interface CaptureQueueStorage {
  list(): Promise<QueuedCapture[]>;
  put(capture: QueuedCapture): Promise<void>;
  remove(id: string): Promise<void>;
}

export type CaptureSender = (capture: QueuedCapture) => Promise<void>;

export class OfflineCaptureQueue {
  constructor(private readonly storage: CaptureQueueStorage) {}

  async sendOrQueue(capture: QueuedCapture, send: CaptureSender): Promise<"sent" | "queued"> {
    try {
      await send(capture);
      return "sent";
    } catch {
      await this.storage.put(capture);
      return "queued";
    }
  }

  /**
   * Stop at the first failed replay. This keeps captures ordered and avoids a
   * tight retry loop while the connection (or server) remains unavailable.
   */
  async flush(send: CaptureSender): Promise<{ sent: string[]; failed: boolean }> {
    const captures = await this.storage.list();
    const sent: string[] = [];
    for (const capture of captures.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))) {
      try {
        await send(capture);
        await this.storage.remove(capture.id);
        sent.push(capture.id);
      } catch {
        return { sent, failed: true };
      }
    }
    return { sent, failed: false };
  }
}
