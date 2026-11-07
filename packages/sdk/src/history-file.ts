import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chainOf } from "./caip.js";
import { historyKey } from "./history.js";
import type { PayeeHistoryStore } from "./interfaces.js";

/** Node history store: one JSON file, replaced atomically. Import from "@redline/sdk/history-file". */
export function createFileHistory(path: string): PayeeHistoryStore {
  let queue: Promise<unknown> = Promise.resolve();

  const read = async (): Promise<Record<string, string>> => {
    try {
      return JSON.parse(await readFile(path, "utf8")) as Record<string, string>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  };

  return {
    record({ payer, domain, account }) {
      const write = queue.then(async () => {
        const data = await read();
        data[historyKey(payer, domain, chainOf(account))] = account;
        await mkdir(dirname(path), { recursive: true });
        const temp = `${path}.tmp`;
        await writeFile(temp, JSON.stringify(data, null, 2));
        await rename(temp, path);
      });
      queue = write.catch(() => undefined);
      return write;
    },
    async lastAccount(payer, domain, chain) {
      await queue;
      return (await read())[historyKey(payer, domain, chain)] ?? null;
    },
  };
}
