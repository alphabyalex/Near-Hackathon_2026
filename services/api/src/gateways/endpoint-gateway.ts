import type { MockWorld } from "../mock/seed.js";
import { VAULT_A } from "../mock/seed.js";
import { NS_PER_MS, type Clock } from "../time.js";

/**
 * A request to change where a vault pays a vendor. Vault v2 holds it for a cooldown and applies it
 * only with a signature from an approver other than the requester.
 */
export interface EndpointChange {
  vaultId: string;
  vendorId: string;
  vendorName: string;
  /** The vendor revision this change creates. An approval is bound to it. */
  revision: number;
  oldAccount: string;
  newAccount: string;
  requestedBy: string;
  requestedAt: string;
  cooldownEndsAt: string;
  status: "pending" | "approved" | "rejected";
}

export interface EndpointApproval {
  vaultId: string;
  vendorId: string;
  revision: number;
  account: string;
  approver: string;
  expiresAt: string;
  /** The NEP-413 signature over the canonical approval payload. */
  message: string;
  publicKey: string;
  signature: string;
  nonce: string;
}

export interface EndpointGateway {
  /** "memory" until the vault v2 client lands. */
  readonly mode: string;
  listChanges(): Promise<EndpointChange[]>;
  approveEndpoint(approval: EndpointApproval): Promise<EndpointChange>;
  rejectEndpoint(input: { vaultId: string; vendorId: string; revision: number; rejectedBy: string }): Promise<EndpointChange>;
}

const HOUR_MS = 3_600_000;
export const ENDPOINT_COOLDOWN_HOURS = 72;

/**
 * Stand-in for vault v2. Seeds two changes on vault A: one still in its cooldown, one past it.
 * An approved change is applied to the vendor once its cooldown has ended.
 * TODO(tharun): replace with the vault v2 client; approveEndpoint maps to `approve_endpoint`.
 */
export function createMemoryEndpointGateway(world: MockWorld, clock: Clock): EndpointGateway {
  const nowMs = () => Number(clock() / NS_PER_MS);
  const iso = (ms: number) => new Date(ms).toISOString();
  const start = nowMs();
  const seed = (vendorId: string, newAccount: string, requestedHoursAgo: number): EndpointChange | null => {
    const vendor = world.vendors.get(vendorId);
    if (!vendor) return null;
    const requested = start - requestedHoursAgo * HOUR_MS;
    return {
      vaultId: VAULT_A,
      vendorId,
      vendorName: vendor.display_name,
      revision: vendor.revision + 1,
      oldAccount: vendor.account_id,
      newAccount,
      requestedBy: "ops.vault-a.wardline.testnet",
      requestedAt: iso(requested),
      cooldownEndsAt: iso(requested + ENDPOINT_COOLDOWN_HOURS * HOUR_MS),
      status: "pending",
    };
  };
  const changes = [seed("vnd_fernhill", "fernhill-cloud.testnet", 20), seed("vnd_quarry", "quarrylanelegal.testnet", 80)].filter(
    (c): c is EndpointChange => c !== null,
  );

  const find = (vaultId: string, vendorId: string, revision: number): EndpointChange => {
    const change = changes.find((c) => c.vaultId === vaultId && c.vendorId === vendorId && c.revision === revision);
    if (!change) throw new Error("No such endpoint change.");
    return change;
  };

  /** Applies approved changes whose cooldown has ended, as vault v2 would on its next payment. */
  const settle = () => {
    for (const change of changes) {
      const vendor = world.vendors.get(change.vendorId);
      if (change.status !== "approved" || !vendor || vendor.revision >= change.revision) continue;
      if (new Date(change.cooldownEndsAt).getTime() > nowMs()) continue;
      world.vendors.set(change.vendorId, { ...vendor, account_id: change.newAccount, revision: change.revision });
    }
  };

  return {
    mode: "memory",
    async listChanges() {
      settle();
      return changes.map((c) => ({ ...c }));
    },
    async approveEndpoint(approval) {
      const change = find(approval.vaultId, approval.vendorId, approval.revision);
      if (change.status !== "pending") throw new Error("This change was already decided.");
      if (change.newAccount !== approval.account) throw new Error("The approval names a different account.");
      if (approval.approver === change.requestedBy) throw new Error("The requester cannot approve their own change.");
      change.status = "approved";
      settle();
      return { ...change };
    },
    async rejectEndpoint(input) {
      const change = find(input.vaultId, input.vendorId, input.revision);
      if (change.status !== "pending") throw new Error("This change was already decided.");
      change.status = "rejected";
      return { ...change };
    },
  };
}
