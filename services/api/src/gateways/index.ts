import type { AgentRunner, DecisionAdapter, EvidenceGateway, VaultGateway } from "@wardline/schemas";
import { NearVaultGateway } from "@wardline/vault-client";
import { CompromisedPaymentAdapter, PaymentRequestAdapter, createAgent } from "@wardline/agent";
import type { MockWorld } from "../mock/seed.js";
import type { Clock } from "../time.js";
import { createMemoryEndpointGateway, type EndpointGateway } from "./endpoint-gateway.js";
import { MockAgentGateway } from "./mock-agent-gateway.js";
import { MockEvidenceGateway } from "./mock-evidence-gateway.js";
import { MockVaultGateway } from "./mock-vault-gateway.js";

export interface Gateways {
  vault: VaultGateway;
  agent: AgentRunner;
  adapter: DecisionAdapter;
  evidence: EvidenceGateway;
  /** Vendor endpoint changes held for cooldown and a second signer. */
  endpoints: EndpointGateway;
  demo?: { compromised: boolean; setCompromised(enabled: boolean): void };
}

/** Swap point: replace a line here when the real gateway from Tharun, Kristian, or Lucy lands. */
export function createGateways(world: MockWorld, now: Clock): Gateways {
  const mockAgent = new MockAgentGateway();

  let vaultGateway: VaultGateway = new MockVaultGateway(world, now);
  if (process.env.WARDLINE_GATEWAY_MODE === "near") {
    try {
      vaultGateway = NearVaultGateway.fromEnv();
    } catch (err) {
      console.warn("Failed to initialize NearVaultGateway from env, falling back to mock:", err);
    }
  }

  let agentRunner: AgentRunner = mockAgent;
  let adapter: DecisionAdapter = mockAgent;
  if (process.env.WARDLINE_AGENT_MODE === "rules") {
    agentRunner = createAgent("rules");
    adapter = new PaymentRequestAdapter();
  } else if (process.env.WARDLINE_AGENT_MODE === "llm") {
    agentRunner = createAgent("llm", { version: process.env.WARDLINE_AGENT_PROMPT === "B" ? "B" : "A" });
    adapter = new PaymentRequestAdapter();
  }

  const gateways: Gateways = {
    vault: vaultGateway,
    agent: agentRunner,
    adapter,
    evidence: new MockEvidenceGateway(world.reports),
    // TODO(tharun): use the vault v2 client here once it exports an EndpointGateway.
    endpoints: createMemoryEndpointGateway(world, now),
  };
  if (process.env.WARDLINE_ENABLE_COMPROMISED_DEMO === "true") {
    const normalAgent = agentRunner;
    const normalAdapter = adapter;
    gateways.demo = { compromised: false, setCompromised(enabled) {
      this.compromised = enabled;
      gateways.agent = enabled ? createAgent("compromised") : normalAgent;
      gateways.adapter = enabled ? new CompromisedPaymentAdapter() : normalAdapter;
    } };
  }
  return gateways;
}
