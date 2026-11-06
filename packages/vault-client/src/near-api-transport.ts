import { Account, teraToGas } from "near-api-js";
import type { ContractCall, ContractView, VaultTransport } from "./types.js";

export class NearApiTransport implements VaultTransport {
  public constructor(private readonly account: Account) {}

  public async call<T>(call: ContractCall): Promise<T> {
    return this.account.callFunction({
      contractId: call.contractId,
      methodName: call.methodName,
      args: { ...call.args },
      gas: call.gas,
      deposit: call.deposit,
      waitUntil: "FINAL",
    }) as Promise<T>;
  }

  public async view<T>(view: ContractView): Promise<T> {
    const result = await this.account.provider.callFunction({
      contractId: view.contractId,
      method: view.methodName,
      args: { ...view.args },
      blockQuery: { finality: "final" },
    });
    if (result === undefined) {
      throw new Error(`view ${view.methodName} returned no value`);
    }
    return result as T;
  }

  public static defaultGas(): bigint {
    return teraToGas("100");
  }
}
