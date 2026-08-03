"use client";

import type { CaptureQueueStorage, QueuedCapture } from "./offline-queue";

const DATABASE_NAME = "notch-capture-queue";
const STORE_NAME = "captures";

export class IndexedDbCaptureStorage implements CaptureQueueStorage {
  private database: Promise<IDBDatabase> | undefined;

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("could not open offline capture storage"));
      });
    }
    return this.database;
  }

  private async request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = run(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("offline capture storage request failed"));
    });
  }

  async list(): Promise<QueuedCapture[]> {
    return this.request<QueuedCapture[]>("readonly", (store) => store.getAll());
  }

  async put(capture: QueuedCapture): Promise<void> {
    await this.request<IDBValidKey>("readwrite", (store) => store.put(capture));
  }

  async remove(id: string): Promise<void> {
    await this.request<undefined>("readwrite", (store) => store.delete(id));
  }
}
