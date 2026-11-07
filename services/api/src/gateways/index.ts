import type { AgentRunner, DecisionAdapter, EvidenceGateway, VaultGateway } from "@redline/schemas";
import { NearVaultGateway } from "@redline/vault-client";
import { PaymentRequestAdapter, createAgent } from "@redline/agent";
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

  let vaultGateway: VaultGateway = new MockVaultGateway(world, now);
  if (process.env.REDLINE_GATEWAY_MODE === "near") {
    try {
      vaultGateway = NearVaultGateway.fromEnv();
    } catch (err) {
      console.warn("Failed to initialize NearVaultGateway from env, falling back to mock:", err);
    }
  }

  let agentRunner: AgentRunner = mockAgent;
  let adapter: DecisionAdapter = mockAgent;
  if (process.env.REDLINE_AGENT_MODE === "rules") {
    agentRunner = createAgent("rules");
    adapter = new PaymentRequestAdapter();
  } else if (process.env.REDLINE_AGENT_MODE === "llm" && process.env.NEAR_AI_API_KEY) {
    agentRunner = createAgent("llm");
    adapter = new PaymentRequestAdapter();
  }

  return {
    vault: vaultGateway,
    agent: agentRunner,
    adapter,
    evidence: new MockEvidenceGateway(world.reports),
  };
}
