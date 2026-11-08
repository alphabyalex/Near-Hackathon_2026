import { describe, expect, it, vi } from "vitest";
import { applyLegacyEnv, legacyEnvName, readEnv } from "../src/legacy-env.js";

describe("env vars renamed to WARDLINE_*", () => {
  it("maps new names to old ones, including VITE_ names", () => {
    expect(legacyEnvName("WARDLINE_API_URL")).toBe("REDLINE_API_URL");
    expect(legacyEnvName("VITE_WARDLINE_API_URL")).toBe("VITE_REDLINE_API_URL");
    expect(legacyEnvName("NEAR_NETWORK")).toBeNull();
  });

  it("reads the new name first, then the old one", () => {
    const warn = vi.fn();
    expect(readEnv("WARDLINE_API_URL", { WARDLINE_API_URL: "new", REDLINE_API_URL: "old" }, warn)).toBe("new");
    expect(readEnv("WARDLINE_API_KEY", { REDLINE_API_KEY: "old" }, warn)).toBe("old");
    expect(readEnv("WARDLINE_MISSING", {}, warn)).toBeUndefined();
  });

  it("copies old names to new ones without overwriting, warns once and never prints values", () => {
    const warn = vi.fn();
    const env: Record<string, string | undefined> = { REDLINE_OWNER_PORT: "8788", REDLINE_ATTESTOR_KEY: "secret-value", WARDLINE_ATTESTOR_KEY: "kept", VITE_REDLINE_MCP_URL: "https://mcp.example" };
    expect(applyLegacyEnv(env, warn).sort()).toEqual(["REDLINE_OWNER_PORT", "VITE_REDLINE_MCP_URL"]);
    expect(env.WARDLINE_OWNER_PORT).toBe("8788");
    expect(env.VITE_WARDLINE_MCP_URL).toBe("https://mcp.example");
    expect(env.WARDLINE_ATTESTOR_KEY).toBe("kept");
    applyLegacyEnv({ REDLINE_OTHER: "x" }, warn);
    readEnv("WARDLINE_API_KEY", { REDLINE_API_KEY: "old" }, warn);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    for (const [message] of warn.mock.calls) {
      expect(message).not.toContain("secret-value");
      expect(message).not.toContain("8788");
    }
  });
});
