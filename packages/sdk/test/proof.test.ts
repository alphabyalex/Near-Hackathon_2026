import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectedProofText, parseProofText, sha256Hex, verifyProviderProof, type ProviderSignature } from "../src/proof.js";

// A real NEAR AI Cloud provider_tee signature, recorded once in fixtures/nearai.
const fx = JSON.parse(readFileSync(new URL("../../../fixtures/nearai/deepseek-plugin.json", import.meta.url), "utf8")) as { model: string; request: { sha256: string }; response: { sha256: string; body_b64: string }; signature: { body_b64: string } };
const sig = JSON.parse(Buffer.from(fx.signature.body_b64, "base64").toString()) as ProviderSignature;
const base = { model: fx.model, requestHash: fx.request.sha256, responseHash: fx.response.sha256, signature: sig, isAttested: (_m: string, s: string) => s.toLowerCase() === sig.signing_address.toLowerCase() };

describe("verifyProviderProof", () => {
  it("accepts a real provider_tee signature over our exact hashes", async () => {
    expect(sha256Hex(Buffer.from(fx.response.body_b64, "base64"))).toBe(fx.response.sha256);
    expect(sig.text).toBe(expectedProofText(fx.model, fx.request.sha256, fx.response.sha256));
    expect(await verifyProviderProof(base)).toEqual({ ok: true, signer: sig.signing_address.toLowerCase(), modelProven: fx.model });
  });

  it("names exactly what is wrong", async () => {
    const problem = async (patch: Partial<typeof base>) => ((await verifyProviderProof({ ...base, ...patch })) as { problem: string }).problem;
    expect(await problem({ signature: null })).toBe("SIGNATURE_MISSING");
    expect(await problem({ model: "z-ai/glm-5.3" })).toBe("MODEL_MISMATCH");
    expect(await problem({ requestHash: "0".repeat(64) })).toBe("REQUEST_HASH_MISMATCH");
    expect(await problem({ responseHash: "0".repeat(64) })).toBe("RESPONSE_HASH_MISMATCH");
    expect(await problem({ signature: { ...sig, signing_address: "0x0000000000000000000000000000000000000001" } })).toBe("SIGNER_MISMATCH");
    expect(await problem({ signature: { ...sig, signature_kind: "gateway" } })).toBe("BAD_SIGNATURE_KIND");
    expect(await problem({ signature: { ...sig, signing_algo: "ed25519" } })).toBe("BAD_SIGNING_ALGO");
    expect(await problem({ isAttested: () => false })).toBe("SIGNER_NOT_ATTESTED");
    expect(await problem({ signature: { ...sig, text: `${fx.model}:${fx.request.sha256}` } })).toBe("MALFORMED_TEXT");
  });

  it("parses model ids that contain colons", () => {
    expect(parseProofText(`a:b/c:${"1".repeat(64)}:${"2".repeat(64)}`)).toEqual({ model: "a:b/c", requestHash: "1".repeat(64), responseHash: "2".repeat(64) });
  });
});
