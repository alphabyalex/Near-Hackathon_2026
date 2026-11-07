import { chainOf } from "./caip.js";
import type { PayeeHistoryStore } from "./interfaces.js";

export const historyKey = (payer: string, domain: string, chain: string): string => JSON.stringify([payer, domain, chain]);

export function createMemoryHistory(): PayeeHistoryStore {
  const last = new Map<string, string>();
  return {
    async record({ payer, domain, account }) {
      last.set(historyKey(payer, domain, chainOf(account)), account);
    },
    async lastAccount(payer, domain, chain) {
      return last.get(historyKey(payer, domain, chain)) ?? null;
    },
  };
}

const STORE = "last_account";

/** Browser history store. Pass `factory` to use something other than the global indexedDB. */
export function createIndexedDbHistory(options: { name?: string; factory?: IDBFactory } = {}): PayeeHistoryStore {
  const factory = options.factory ?? globalThis.indexedDB;
  if (!factory) throw new Error("IndexedDB is not available here.");
  const opened = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(options.name ?? "redline-history", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const run = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await opened;
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  };
  return {
    async record({ payer, domain, account }) {
      await run("readwrite", (store) => store.put(account, historyKey(payer, domain, chainOf(account))));
    },
    async lastAccount(payer, domain, chain) {
      const value = await run<unknown>("readonly", (store) => store.get(historyKey(payer, domain, chain)));
      return typeof value === "string" ? value : null;
    },
  };
}
