import { sha256Hex, verifyProviderProof } from "@wardline/sdk";
import { describe, expect, it } from "vitest";
import { createCheapAi, createReplayProvider, createSimTee, demoFetch, loadAttestations, loadRecording, RECORDED, SIM_MODEL, SIM_TEE_ACCOUNT } from "../src/index.js";

const EXPENSIVE = loadRecording(RECORDED.expensive);
const CHEAP = loadRecording(RECORDED.cheap);
const post = (bytes: Uint8Array | string) => new Request("http://x.demo.internal/v1/chat/completions", { method: "POST", body: typeof bytes === "string" ? bytes : Buffer.from(bytes) });
const attested = (model: string, signer: string) => loadAttestations().some((a) => a.model === model && a.signingAddress === signer.toLowerCase());

describe("recorded NEAR AI fixtures", () => {
  it("verify against the recorded attestation reports", async () => {
    for (const rec of [EXPENSIVE, CHEAP]) {
      const check = await verifyProviderProof({ model: rec.model, requestHash: rec.requestHash, responseHash: rec.responseHash, signature: rec.signature, isAttested: attested });
      expect(check).toMatchObject({ ok: true, modelProven: rec.model });
    }
    expect(sha256Hex(EXPENSIVE.responseBytes)).toBe(EXPENSIVE.responseHash);
  });
});

describe("demo providers", () => {
  it("replay answers only the exact recorded request bytes", async () => {
    const replay = createReplayProvider();
    expect(new Uint8Array(await (await replay(post(EXPENSIVE.requestBytes))).arrayBuffer())).toEqual(EXPENSIVE.responseBytes);
    const reordered = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(Buffer.from(EXPENSIVE.requestBytes).toString())).reverse()));
    expect((await replay(post(reordered))).status).toBe(404);
  });

  it("cheapai claims the model you asked for and passes through a signature naming the cheap one", async () => {
    const cheap = createCheapAi("wrong-model");
    const res = (await (await cheap(post(EXPENSIVE.requestBytes))).json()) as { id: string; model: string };
    expect(res.model).toBe(EXPENSIVE.model);
    const sig = (await (await cheap(new Request(`http://x.demo.internal/v1/signature/${res.id}`))).json()) as { text: string };
    expect(sig.text.startsWith(`${CHEAP.model}:`)).toBe(true);
    expect((await createCheapAi("no-signature")(new Request(`http://x.demo.internal/v1/signature/${res.id}`))).status).toBe(404);
  });

  it("the sim TEE signs fresh responses that verify only for its own model and key", async () => {
    const sim = createSimTee();
    const req = new TextEncoder().encode(JSON.stringify({ model: SIM_MODEL, messages: [{ role: "user", content: "hi" }] }));
    const res = await sim(post(req));
    const bytes = new Uint8Array(await res.arrayBuffer());
    const id = (JSON.parse(Buffer.from(bytes).toString()) as { id: string }).id;
    const sig = (await (await sim(new Request(`http://x.demo.internal/v1/signature/${id}`))).json()) as never;
    const isSim = (m: string, s: string) => m === SIM_MODEL && s.toLowerCase() === SIM_TEE_ACCOUNT.address.toLowerCase();
    expect(await verifyProviderProof({ model: SIM_MODEL, requestHash: sha256Hex(req), responseHash: sha256Hex(bytes), signature: sig, isAttested: isSim })).toMatchObject({ ok: true });
    expect(await verifyProviderProof({ model: SIM_MODEL, requestHash: sha256Hex(req), responseHash: sha256Hex(bytes), signature: sig, isAttested: attested })).toMatchObject({ ok: false, problem: "SIGNER_NOT_ATTESTED" });
  });

  it("demoFetch refuses any host that is not a demo provider", async () => {
    await expect(demoFetch({})("https://cloud-api.near.ai/v1/models")).rejects.toThrow(/refuses/);
  });
});
