import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import {
  type AgentContext,
  AgentContextSchema,
  type DecisionKind,
  DecisionSchema,
  type Intake,
  IntakeSchema,
  ScenarioSchema,
} from "@wardline/schemas";
import { DEV_FIXTURES_DIR, loadRepoEnv, MANIFEST_DIR, MODEL_ID, nearAiBaseUrl, SCRATCH_FIXTURES_DIR } from "./agent-config.js";
import { canonicalJson } from "./canonical.js";
import { createAgent } from "./factory.js";
import { buildManifest, manifestDigest } from "./manifest.js";
import type { PromptVersion } from "./prompts.js";
import type { AgentKind } from "./report.js";

const USAGE = `Usage (from anywhere in the repo):
  pnpm --filter agent decide <intake.json> <context.json> [--agent llm|rules|review|replay|compromised] [--prompt A|B] [--record]
  pnpm --filter agent check [--agent llm|rules|review|replay|compromised] [--prompt A|B] [--record]
  pnpm --filter agent manifest [--write | --verify]
  pnpm --filter agent models`;

const AGENTS: AgentKind[] = ["llm", "rules", "review", "replay", "compromised"];

/** Hidden test invoices must stay hidden from this workstream, so our scores stay honest. */
function refuseHiddenFixtures(path: string): void {
  const parts = resolve(path).toLowerCase().split(sep);
  const inFixtures = parts.lastIndexOf("fixtures");
  const hidden = inFixtures >= 0 && parts[inFixtures + 1] !== "dev";
  if (hidden) throw new Error(`refusing to read ${path}: the agent only tunes on fixtures/dev and scratch fixtures`);
}

/** pnpm runs scripts in services/agent, so paths are tried against the caller's folder first. */
function resolveInput(path: string): string {
  const callerDir = process.env.INIT_CWD ?? process.cwd();
  const candidate = isAbsolute(path) ? path : resolve(callerDir, path);
  const found = existsSync(candidate) ? candidate : resolve(path);
  refuseHiddenFixtures(found);
  return found;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

interface Flags {
  agent: AgentKind;
  prompt: PromptVersion;
  record: boolean;
}

function readFlags(values: { agent?: string | undefined; prompt?: string | undefined; record?: boolean | undefined }): Flags {
  const agent = (values.agent ?? "rules") as AgentKind;
  if (!AGENTS.includes(agent)) throw new Error(`unknown agent ${agent}\n${USAGE}`);
  const prompt = (values.prompt ?? "A") as PromptVersion;
  if (prompt !== "A" && prompt !== "B") throw new Error(`unknown prompt version ${prompt}\n${USAGE}`);
  if (values.record && agent !== "llm") throw new Error("--record only works with --agent llm");
  return { agent, prompt, record: values.record ?? false };
}

async function cmdDecide(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { agent: { type: "string" }, prompt: { type: "string" }, record: { type: "boolean" } },
  });
  const [intakePath, contextPath] = positionals;
  if (!intakePath || !contextPath) throw new Error(USAGE);
  const flags = readFlags(values);
  const intake = IntakeSchema.parse(readJson(resolveInput(intakePath)));
  const context = AgentContextSchema.parse(readJson(resolveInput(contextPath)));
  const agent = createAgent(flags.agent, { version: flags.prompt, record: flags.record });
  const { decision, report } = await agent.decideWithReport(intake, context);
  console.log(JSON.stringify({ decision, timing_ms: report.latency_ms, token_usage: report.usage, cost_usd: report.cost_usd, report }, null, 2));
  return 0;
}

interface CheckCase {
  name: string;
  intake: Intake;
  context: AgentContext;
  acceptable: DecisionKind[] | null;
}

function loadScratchCases(): CheckCase[] {
  const context = AgentContextSchema.parse(readJson(join(SCRATCH_FIXTURES_DIR, "context.json")));
  const expected = readJson(join(SCRATCH_FIXTURES_DIR, "expected.json")) as Record<string, DecisionKind[]>;
  return Object.entries(expected).map(([name, acceptable]) => ({
    name: `scratch/${name}`,
    intake: IntakeSchema.parse(readJson(join(SCRATCH_FIXTURES_DIR, `${name}.intake.json`))),
    context,
    acceptable,
  }));
}

/** Lucy's Scenario files in fixtures/dev, once pushed. Files of another shape are skipped. */
function loadDevCases(): CheckCase[] {
  if (!existsSync(DEV_FIXTURES_DIR)) return [];
  const cases: CheckCase[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".json")) {
        const scenario = ScenarioSchema.safeParse(readJson(path));
        if (scenario.success && scenario.data.split === "DEV") {
          cases.push({
            name: `dev/${relative(DEV_FIXTURES_DIR, path).replaceAll(sep, "/")}`,
            intake: scenario.data.intake,
            context: scenario.data.context,
            acceptable: scenario.data.acceptable_decisions,
          });
        }
      }
    }
  };
  walk(DEV_FIXTURES_DIR);
  return cases;
}

/** Gate check: every case must produce a schema-valid Decision. Exits 1 if one does not. */
async function cmdCheck(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { agent: { type: "string" }, prompt: { type: "string" }, record: { type: "boolean" } } });
  const flags = readFlags(values);
  const agent = createAgent(flags.agent, { version: flags.prompt, record: flags.record });
  const cases = [...loadScratchCases(), ...loadDevCases()];
  let invalid = 0;
  let accepted = 0;
  let tokens = 0;
  let cost = 0;
  for (const c of cases) {
    const { decision, report } = await agent.decideWithReport(c.intake, c.context);
    const valid = DecisionSchema.safeParse(decision).success;
    if (!valid) invalid += 1;
    const ok = c.acceptable?.includes(decision.decision) ?? false;
    if (ok) accepted += 1;
    tokens += report.usage.total_tokens;
    cost += report.cost_usd ?? 0;
    const extras = [report.fallback ? `FALLBACK: ${report.fallback}` : "", report.guard.length > 0 ? `GUARD: ${report.guard.join(" ")}` : ""].filter(Boolean).join(" ");
    console.log(
      [c.name.padEnd(36), decision.decision.padEnd(6), ok ? "as expected" : `expected ${c.acceptable?.join("/") ?? "?"}`, decision.reason_codes.join(","), `${report.latency_ms}ms`, extras].join("  "),
    );
  }
  console.log(`\n${flags.agent}: ${cases.length - invalid}/${cases.length} valid Decisions, ${accepted}/${cases.length} as expected, ${tokens} tokens, $${cost.toFixed(6)}`);
  return invalid === 0 ? 0 : 1;
}

const VERSIONS: PromptVersion[] = ["A", "B"];
const manifestPath = (version: PromptVersion): string => join(MANIFEST_DIR, `version-${version}.json`);
const manifestFile = (version: PromptVersion): string => {
  const manifest = buildManifest(version);
  return `${JSON.stringify({ manifest_digest: manifestDigest(manifest), manifest }, null, 2)}\n`;
};

/** --write records the current manifests; --verify exits 1 if the code no longer matches them. */
async function cmdManifest(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { write: { type: "boolean" }, verify: { type: "boolean" } } });
  let status = 0;
  for (const version of VERSIONS) {
    const content = manifestFile(version);
    if (values.write) {
      mkdirSync(MANIFEST_DIR, { recursive: true });
      writeFileSync(manifestPath(version), content);
    }
    if (values.verify) {
      const same = existsSync(manifestPath(version)) && canonicalJson(readJson(manifestPath(version))) === canonicalJson(JSON.parse(content));
      if (!same) status = 1;
      console.log(`version ${version}: ${same ? "matches" : "DIFFERS from"} ${relative(process.cwd(), manifestPath(version))}`);
    }
    console.log(content);
  }
  return status;
}

/** Lists the TEE-hosted models on NEAR AI Cloud, to re-check the choice in agent-config.ts. No key needed. */
async function cmdModels(): Promise<number> {
  const response = await fetch(`${nearAiBaseUrl()}/model/list`);
  if (!response.ok) throw new Error(`model list failed: HTTP ${response.status}`);
  const { models } = (await response.json()) as {
    models: {
      modelId: string;
      inputCostPerToken: { amount: number; scale: number };
      outputCostPerToken: { amount: number; scale: number };
      metadata: { verifiable?: boolean; attestationSupported?: boolean; providerType?: string; isReady?: boolean; supportedFeatures?: string[] };
    }[];
  };
  const perMillion = (p: { amount: number; scale: number }): string => ((p.amount / 10 ** p.scale) * 1e6).toFixed(2);
  const tee = models.filter((m) => m.metadata.verifiable && m.metadata.attestationSupported);
  for (const m of tee) {
    console.log(
      [
        m.modelId === MODEL_ID ? "*" : " ",
        m.modelId.padEnd(46),
        (m.metadata.providerType ?? "?").padEnd(8),
        m.metadata.isReady === true ? "ready" : "     ",
        `$${perMillion(m.inputCostPerToken)}/$${perMillion(m.outputCostPerToken)} per M`,
        (m.metadata.supportedFeatures ?? []).join(","),
      ].join(" "),
    );
  }
  const chosen = tee.some((m) => m.modelId === MODEL_ID);
  console.log(`\n* ${MODEL_ID} is ${chosen ? "TEE-hosted and listed" : "NOT in the TEE-hosted list"}.`);
  return chosen ? 0 : 1;
}

async function main(): Promise<number> {
  loadRepoEnv();
  const [command, ...rest] = process.argv.slice(2).filter((a) => a !== "--");
  if (command === "decide") return cmdDecide(rest);
  if (command === "check") return cmdCheck(rest);
  if (command === "manifest") return cmdManifest(rest);
  if (command === "models") return cmdModels();
  console.error(USAGE);
  return 2;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
