import type { PayeeVendor } from "@wardline/schemas";
import { formatAccount, normalizeDomain, tryParseAccount } from "./caip.js";
import type { PaymentHistory, PayeeRegistry } from "./types.js";

const norm = (a: string): string => {
  const p = tryParseAccount(a);
  return p ? formatAccount(p) : a;
};

/**
 * In-memory registry with the same semantics we expect from the contract: an account is a
 * verified payee only when it is active and past activatesAt. For tests and local demos.
 */
export class InMemoryPayeeRegistry implements PayeeRegistry {
  private readonly vendors: PayeeVendor[];

  constructor(
    vendors: PayeeVendor[],
    private readonly now: () => number = () => Date.now(),
  ) {
    this.vendors = vendors.map((v) => ({ ...v, domain: normalizeDomain(v.domain), accounts: v.accounts.map((a) => ({ ...a, account: norm(a.account) })) }));
  }

  private isActive(a: PayeeVendor["accounts"][number]): boolean {
    return a.status === "active" && (a.activatesAt === null || Date.parse(a.activatesAt) <= this.now());
  }

  async getVendor(domain: string) {
    return this.vendors.find((v) => v.domain === normalizeDomain(domain)) ?? null;
  }
  async getVendorByAccount(caip10: string) {
    const id = norm(caip10);
    return this.vendors.find((v) => v.accounts.some((a) => a.account === id)) ?? null;
  }
  async isVerifiedPayee(caip10: string, domain: string) {
    const v = await this.getVendor(domain);
    const id = norm(caip10);
    return !!v?.accounts.some((a) => a.account === id && this.isActive(a));
  }
  async resolve(domain: string, chain: string) {
    const v = await this.getVendor(domain);
    const a = v?.accounts.find((x) => this.isActive(x) && tryParseAccount(x.account)?.chainId === chain);
    return a?.account ?? null;
  }
  async listVendors() {
    return this.vendors;
  }
}

export class InMemoryPaymentHistory implements PaymentHistory {
  private readonly last = new Map<string, string>();
  record(payer: string, domain: string, account: string): void {
    this.last.set(`${payer}\n${normalizeDomain(domain)}`, account);
  }
  async lastPaidAccount(payer: string, domain: string) {
    return this.last.get(`${payer}\n${normalizeDomain(domain)}`) ?? null;
  }
}
