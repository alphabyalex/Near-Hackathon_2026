import { LLM_SETTINGS } from "@redline/agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireLlmIfConfigured } from "../src/llm-preflight.js";
import { DECIDE_TIMEOUT_MS } from "../src/rubric.js";

const original = process.env.NEAR_AI_API_KEY;
afterEach(() => {
  if (original === undefined) delete process.env.NEAR_AI_API_KEY;
  else process.env.NEAR_AI_API_KEY = original;
  vi.restoreAllMocks();
});

const ok = async () => null;

describe("LLM preflight", () => {
  it("warns and continues when no key is set and the LLM was not asked for by name", async () => {
    delete process.env.NEAR_AI_API_KEY;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(requireLlmIfConfigured(["llm", "rules"], ["rules"], ["llm"], false, ok)).resolves.toBeUndefined();
    expect(warn.mock.calls[0]?.[0]).toMatch(/NEAR_AI_API_KEY is not set/);
  });

  it("fails when an LLM agent is named in --agents but did not load", async () => {
    delete process.env.NEAR_AI_API_KEY;
    await expect(requireLlmIfConfigured(["llm"], [], ["llm"], true, ok)).rejects.toThrow(/not loaded: llm/);
  });

  it("fails when a key is set but the LLM agent is missing", async () => {
    process.env.NEAR_AI_API_KEY = "test-key";
    await expect(requireLlmIfConfigured(["llm", "llm-b"], ["llm"], ["llm-b"], false, ok)).rejects.toThrow(/llm-b/);
  });

  it("fails when NEAR AI Cloud is unreachable or rejects the key", async () => {
    process.env.NEAR_AI_API_KEY = "test-key";
    await expect(requireLlmIfConfigured(["llm"], ["llm"], [], false, async () => "NEAR AI Cloud is unreachable")).rejects.toThrow(/cannot run: NEAR AI Cloud is unreachable/);
  });

  it("passes when the agent loaded and the probe answers", async () => {
    process.env.NEAR_AI_API_KEY = "test-key";
    const probe = vi.fn(ok);
    await expect(requireLlmIfConfigured(["llm", "rules"], ["llm", "rules"], [], false, probe)).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledOnce();
  });

  it("does nothing for a run without LLM agents", async () => {
    const probe = vi.fn(ok);
    await requireLlmIfConfigured(["rules"], ["rules"], [], true, probe);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("Gym timeout", () => {
  it("covers every LLM attempt, so a retry can finish before the Gym gives up", () => {
    expect(DECIDE_TIMEOUT_MS).toBeGreaterThan(LLM_SETTINGS.max_attempts * LLM_SETTINGS.timeout_ms);
  });
});
