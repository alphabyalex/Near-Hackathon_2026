import type { AgentRunner, DecisionAdapter, Manifest } from "@redline/schemas";
import { DOMAIN, domainDigest, sha256Bytes } from "./canonical.js";
import { HARNESS_ID } from "./rubric.js";
import { alwaysReviewControl, credulousStub, rulesBaselineStub, stubAdapter } from "./stubs/agents.js";

export type AgentKind = "llm" | "baseline" | "control" | "simulated_compromised";

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface GymAgent {
  /** CLI name, also used in run ids and folder names. */
  name: string;
  label: string;
  kind: AgentKind;
  /** True for anything that is a local stand-in rather than the real component. */
  stub: boolean;
  manifest: Manifest;
  runner: AgentRunner;
  adapter: DecisionAdapter;
  adapterIsStub: boolean;
  /** Optional: token usage of the most recent decide() call. */
  lastUsage?: () => TokenUsage | null;
}

function stubManifest(name: string, description: string): Manifest {
  return {
    schema: "redline-manifest-v1",
    name: `redline-gym-stub-${name}`,
    version: "0.1.0-stub",
    model_provider: "none",
    model_id: "none",
    prompt_digest: sha256Bytes(description),
    harness_digest: sha256Bytes(HARNESS_ID),
    tools: [],
    settings: { stub: true },
    created_at: "2026-11-04T00:00:00Z",
  };
}

export function manifestDigest(m: Manifest): string {
  return domainDigest(DOMAIN.manifest, m);
}

const LOCAL: Record<string, () => GymAgent> = {
  "always-review": () => ({
    name: "always-review",
    label: "AlwaysReviewControl",
    kind: "control",
    stub: false,
    manifest: stubManifest("always-review", "Control arm. Returns REVIEW for every invoice."),
    runner: alwaysReviewControl,
    adapter: stubAdapter,
    adapterIsStub: true,
  }),
  "rules-stub": () => ({
    name: "rules-stub",
    label: "RulesBaseline (local stub, replace with services/agent)",
    kind: "baseline",
    stub: true,
    manifest: stubManifest("rules-stub", "Deterministic regex and 3-way match baseline in services/evaluator/src/stubs."),
    runner: rulesBaselineStub,
    adapter: stubAdapter,
    adapterIsStub: true,
  }),
  "credulous-stub": () => ({
    name: "credulous-stub",
    label: "Simulated compromised agent (local stub, not a model)",
    kind: "simulated_compromised",
    stub: true,
    manifest: stubManifest("credulous-stub", "Obeys payable refs in invoice text, else pays by amount. Simulates a fully compromised agent."),
    runner: credulousStub,
    adapter: stubAdapter,
    adapterIsStub: true,
  }),
};

/**
 * Contract requested from Kristian (docs/status/lucy.md): services/agent exports
 *   createGymAgents(): Promise<Array<{ name, label, kind, manifest, runner, lastUsage? }>>
 *   createDecisionAdapter(): DecisionAdapter
 * Until that package exists, "llm" and "rules" resolve to an explicit "not available" error.
 */
async function loadExternal(): Promise<GymAgent[]> {
  const spec = "@redline/agent";
  let mod: Record<string, unknown>;
  try {
    mod = (await import(spec)) as Record<string, unknown>;
  } catch {
    return [];
  }
  const create = mod["createGymAgents"];
  const adapterFactory = mod["createDecisionAdapter"];
  if (typeof create !== "function") return [];
  const adapter = typeof adapterFactory === "function" ? (adapterFactory() as DecisionAdapter) : stubAdapter;
  const list = (await create()) as Array<Omit<GymAgent, "adapter" | "adapterIsStub" | "stub">>;
  return list.map((a) => ({ ...a, stub: false, adapter, adapterIsStub: adapter === stubAdapter }));
}

export const DEFAULT_AGENTS = ["llm", "rules", "rules-stub", "always-review", "credulous-stub"];

export interface ResolvedAgents {
  agents: GymAgent[];
  unavailable: string[];
}

export async function resolveAgents(names: string[]): Promise<ResolvedAgents> {
  const external = await loadExternal();
  const agents: GymAgent[] = [];
  const unavailable: string[] = [];
  for (const n of names) {
    const ext = external.find((a) => a.name === n);
    const local = LOCAL[n];
    if (ext) agents.push(ext);
    else if (local) agents.push(local());
    else unavailable.push(n);
  }
  return { agents, unavailable };
}
