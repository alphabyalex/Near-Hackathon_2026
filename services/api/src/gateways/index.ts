import type { AgentRunner, DecisionAdapter, EvidenceGateway, VaultGateway } from "@redline/schemas";
import type { MockWorld } from "../mock/seed.js";
import type { Clock } from "../time.js";
import { MockAgentGateway } from "./mock-agent-gateway.js";
import { MockEvidenceGateway } from "./mock-evidence-gateway.js";
import { MockVaultGateway } from "./mock-vault-gateway.js";

export interface Gateways {
  vault: VaultGateway;
  agent: AgentRunner;
  adapter: DecisionAdapter;
  evidence: EvidenceGateway;
}

/** Swap point: replace a line here when the real gateway from Tharun, Kristian, or Lucy lands. */
export function createGateways(world: MockWorld, now: Clock): Gateways {
  const mockAgent = new MockAgentGateway();
  return {
    vault: new MockVaultGateway(world, now),
    agent: mockAgent,
    adapter: mockAgent,
    evidence: new MockEvidenceGateway(world.reports),
  };
}
