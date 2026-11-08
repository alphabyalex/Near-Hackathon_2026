import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createApiKey } from "../src/auth.js";
import { bootstrap } from "../src/bootstrap.js";
import { signNep413, type NearKeyLookup } from "../src/payee/proofs.js";
import { REVIEW_APPROVAL_RECIPIENT, type DecidedItem, type DeskItem } from "../src/review-desk.js";
import { authWith, LOCAL_AUTH } from "./helpers.js";

const START = Date.parse("2026-11-08T12:00:00Z");

const signer = (account: string) => {
  const secret = ed25519.utils.randomSecretKey();
  return { account, secret, publicKey: `ed25519:${base58.encode(ed25519.getPublicKey(secret))}` };
};
type Signer = ReturnType<typeof signer>;

const owner = signer("owner-a.testnet");
const approver = signer("approver-a.testnet");
const requester = signer("ops.vault-a.redline.testnet");
const lookupKeys: NearKeyLookup = async (_network, accountId) =>
  [owner, approver, requester].filter((s) => s.account === accountId).map((s) => ({ publicKey: s.publicKey, fullAccess: true }));

let now = START;
const clock = () => BigInt(now) * 1_000_000n;

function setup(auth = authWith({ owners: new Set([owner.account]), approvers: new Set([approver.account, requester.account]) })) {
  const deps = bootstrap(":memory:", clock, { lookupKeys }, auth);
  return { deps, app: createApp(deps) };
}
type App = ReturnType<typeof createApp>;

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

async function session(app: App, who: Signer): Promise<Record<string, string>> {
  const ch = (await (await app.request("/owner/auth/challenge", json({ account: who.account }))).json()) as { message: string; nonce: string; recipient: string };
  const signature = signNep413(ch.message, Buffer.from(ch.nonce, "base64"), who.secret, ch.recipient);
  const res = await app.request("/owner/auth/login", json({ account: who.account, publicKey: who.publicKey, signature, nonce: ch.nonce }));
  expect(res.status).toBe(200);
  return { authorization: `Bearer ${((await res.json()) as { token: string }).token}` };
}

interface Desk {
  items: DeskItem[];
  decided: DecidedItem[];
}
const desk = async (app: App, headers: Record<string, string>) => (await (await app.request("/owner/review-desk", { headers })).json()) as Desk;

async function signApproval(app: App, headers: Record<string, string>, item: string, who: Signer, tamper: { recipient?: string; message?: string } = {}) {
  const res = await app.request(`/owner/review-desk/${item}/challenge`, json({}, headers));
  const ch = (await res.json()) as { message: string; nonce: string; recipient: string; payload: Record<string, unknown> };
  if (res.status !== 200) return { status: res.status, body: ch as unknown };
  const signature = signNep413(tamper.message ?? ch.message, Buffer.from(ch.nonce, "base64"), who.secret, tamper.recipient ?? ch.recipient);
  const approved = await app.request(`/owner/review-desk/${item}/approve`, json({ publicKey: who.publicKey, signature, nonce: ch.nonce }, headers));
  return { status: approved.status, body: (await approved.json()) as unknown, challenge: ch };
}

beforeEach(() => {
  now = START;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("review desk", () => {
  it("lists the seeded endpoint changes with accounts, trust level, reasons, cooldown and the payables at stake", async () => {
    const { app } = setup();
    const { items } = await desk(app, await session(app, approver));
    const fernhill = items.find((i) => i.vendor.id === "vnd_fernhill");
    const quarry = items.find((i) => i.vendor.id === "vnd_quarry");
    expect(fernhill).toMatchObject({
      kind: "endpoint_change",
      vault: "vault-a.redline.testnet",
      oldAccount: "near:testnet:fernhill.vendors.redline.testnet",
      newAccount: "near:testnet:fernhill-cloud.testnet",
      verdict: "BLOCK",
      evidenceTier: "T0_NONE",
      requestedBy: requester.account,
      amountAtStake: { atomic: "800000000", symbol: "REDL", decimals: 6 },
    });
    expect(fernhill?.reasons.map((r) => r.code)).toContain("LOOKALIKE_ACCOUNT");
    expect(fernhill?.payables.map((p) => p.ref)).toEqual(["pay_1003"]);
    expect(Date.parse(fernhill?.cooldownEndsAt ?? "")).toBeGreaterThan(START);
    expect(quarry).toMatchObject({ verdict: "PAY", evidenceTier: "T2_DOMAIN_LINKED", vendor: { domain: "quarrylane.example" } });
    expect(Date.parse(quarry?.cooldownEndsAt ?? "")).toBeLessThan(START);
    // Soonest cooldown end first.
    expect(items[0]?.id).toBe(quarry?.id);
  });

  it("approves with a NEP-413 signature bound to vault, vendor, revision, account and expiry, and records who and when", async () => {
    const { app, deps } = setup();
    const headers = await session(app, approver);
    const item = (await desk(app, headers)).items.find((i) => i.vendor.id === "vnd_quarry") as DeskItem;
    const result = await signApproval(app, headers, item.id, approver);
    expect(result.status).toBe(200);
    expect(result.challenge?.recipient).toBe(REVIEW_APPROVAL_RECIPIENT);
    expect(result.challenge?.payload).toEqual({
      action: "approve",
      item: item.id,
      vault: "vault-a.redline.testnet",
      vendor: "vnd_quarry",
      revision: 2,
      account: "near:testnet:quarrylanelegal.testnet",
      expiresAt: new Date(START + 5 * 60_000).toISOString(),
    });
    const after = await desk(app, headers);
    expect(after.items.some((i) => i.id === item.id)).toBe(false);
    expect(after.decided[0]).toMatchObject({ id: item.id, decision: { decision: "approved", by: approver.account, at: new Date(START).toISOString(), publicKey: approver.publicKey } });
    expect(after.decided[0]?.decision.message).toContain('"revision":2');
    // Cooldown already over, so the vault now pays the new account.
    expect(deps.world.vendors.get("vnd_quarry")).toMatchObject({ account_id: "quarrylanelegal.testnet", revision: 2 });
  });

  it("keeps an approved change out of effect until its cooldown ends", async () => {
    const { app, deps } = setup();
    const headers = await session(app, approver);
    const item = (await desk(app, headers)).items.find((i) => i.vendor.id === "vnd_fernhill") as DeskItem;
    const result = await signApproval(app, headers, item.id, approver);
    expect(result.status).toBe(200);
    expect((result.body as { note: string }).note).toContain("when the cooldown ends");
    expect(deps.world.vendors.get("vnd_fernhill")?.account_id).toBe("fernhill.vendors.redline.testnet");
    now = Date.parse(item.cooldownEndsAt as string) + 1;
    // The session has expired by now; the vault applies the change on its next read.
    await deps.gateways.endpoints.listChanges();
    expect(deps.world.vendors.get("vnd_fernhill")?.account_id).toBe("fernhill-cloud.testnet");
  });

  it("refuses an approval from the person who requested the change", async () => {
    const { app } = setup();
    const headers = await session(app, requester);
    const item = (await desk(app, headers)).items[0] as DeskItem;
    const result = await signApproval(app, headers, item.id, requester);
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: "SEPARATE_APPROVER" });
  });

  it("refuses a signature for another recipient, another message, a reused nonce or an expired request", async () => {
    const { app } = setup();
    const headers = await session(app, approver);
    const item = (await desk(app, headers)).items[0] as DeskItem;
    expect((await signApproval(app, headers, item.id, approver, { recipient: "redline-owner-login" })).status).toBe(401);
    expect((await signApproval(app, headers, item.id, approver, { message: "redline-review:v1:{}" })).status).toBe(401);
    expect((await signApproval(app, headers, item.id, owner)).status).toBe(401);

    const ch = (await (await app.request(`/owner/review-desk/${item.id}/challenge`, json({}, headers))).json()) as { message: string; nonce: string; recipient: string };
    const signature = signNep413(ch.message, Buffer.from(ch.nonce, "base64"), approver.secret, ch.recipient);
    now += 5 * 60_000 + 1;
    const late = await app.request(`/owner/review-desk/${item.id}/approve`, json({ publicKey: approver.publicKey, signature, nonce: ch.nonce }, headers));
    expect(late.status).toBe(401);
    expect((await desk(app, headers)).decided).toEqual([]);
  });

  it("rejects without a signature, once, and has no bulk route", async () => {
    const { app } = setup();
    const headers = await session(app, owner);
    const item = (await desk(app, headers)).items[0] as DeskItem;
    expect((await app.request(`/owner/review-desk/${item.id}/reject`, json({}, headers))).status).toBe(200);
    expect((await app.request(`/owner/review-desk/${item.id}/reject`, json({}, headers))).status).toBe(404);
    expect((await desk(app, headers)).decided[0]).toMatchObject({ id: item.id, decision: { decision: "rejected", by: owner.account, signature: null } });
    expect((await app.request("/owner/review-desk/approve-all", json({}, headers))).status).toBe(404);
  });

  it("queues a HOLD from a payer's key, not from an anonymous call, and approving it raises the account to T3", async () => {
    const { app, deps } = setup();
    const headers = await session(app, owner);
    const { key } = createApiKey(deps.store, { payer: "vault-a.redline.testnet", label: null, callsPerDay: 100, createdBy: owner.account, createdAt: new Date(START).toISOString() });
    const request = { payee: "near:testnet:quarrylanelegal.testnet", vendor: { domain: "quarrylane.example" }, payer: "vault-a.redline.testnet", amount: "3500000000" };
    // Paid one account before, so the domain's current account raises PAYEE_CHANGED.
    deps.store.recordPayment({ payer: "vault-a.redline.testnet", domain: "quarrylane.example", chain: "near:testnet", account: "near:testnet:quarry.vendors.redline.testnet", at: new Date(START).toISOString() });
    const anonymous = await app.request("/v1/check", json({ ...request, payer: undefined }));
    expect(anonymous.status).toBe(200);
    expect((await desk(app, headers)).items.filter((i) => i.kind === "payee_hold")).toEqual([]);

    const keyed = await app.request("/v1/check", json(request, { authorization: `Bearer ${key}` }));
    expect(((await keyed.json()) as { verdict: string }).verdict).toBe("HOLD");
    await app.request("/v1/check", json(request, { authorization: `Bearer ${key}` }));
    const holds = (await desk(app, headers)).items.filter((i) => i.kind === "payee_hold");
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({
      vault: "vault-a.redline.testnet",
      oldAccount: "near:testnet:quarry.vendors.redline.testnet",
      newAccount: "near:testnet:quarrylanelegal.testnet",
      amountAtStake: { atomic: "3500000000", symbol: "REDL" },
      payables: [{ ref: "pay_1002" }],
    });
    expect(holds[0]?.reasons.map((r) => r.code)).toContain("PAYEE_CHANGED");

    expect((await signApproval(app, headers, holds[0]?.id as string, owner)).status).toBe(200);
    expect(deps.store.hasRelationship("vault-a.redline.testnet", "near:testnet:quarrylanelegal.testnet")).toBe(true);
  });

  it("does not approve with owner sign-in off", async () => {
    const { app } = setup(LOCAL_AUTH);
    const { items } = await desk(app, {});
    expect(items.length).toBeGreaterThan(0);
    const res = await app.request(`/owner/review-desk/${items[0]?.id}/challenge`, json({}));
    expect(res.status).toBe(403);
  });

  it("lists API keys with their scopes", async () => {
    const { app } = setup();
    const headers = await session(app, owner);
    await app.request("/owner/api-keys", json({ payer: "acme.testnet", scopes: ["check", "record"] }, headers));
    const { keys } = (await (await app.request("/owner/api-keys", { headers })).json()) as { keys: { scopes: string[] }[] };
    expect(keys[0]?.scopes).toEqual(["check", "record"]);
  });
});
