import { describe, expect, it } from "vitest";
import { buildProposal, createSimDao, createSputnikClient, decodeProposal, type SputnikProposal, type ViewProvider, type WardlineAction, type WardlineContracts } from "../src/index.js";

const contracts: WardlineContracts = { meter: "meter.wardline.testnet", registry: "models.wardline.testnet", pool: "mutual.wardline.testnet", token: "wusd.wardline.testnet", vault: "vault-a.wardline.testnet" };
const DAO = "aurora-lab.sputnikv2.testnet";

const ACTIONS: WardlineAction[] = [
  { type: "fund_budget", budget_id: "bgt_aurora", amount: "25000000" },
  { type: "set_allowance", budget_id: "bgt_aurora", member: "bob.testnet", allowance: "7000000" },
  { type: "add_provider", provider_id: "nearai", pay_to: "nearai.testnet", model_ids: ["z-ai/glm-5.3-flash"] },
  { type: "approve_payout_change", vendor_id: "vnd_fernhill", revision: 2, account: "fernhill-cloud.testnet" },
  { type: "set_pool_param", name: "large_claim_threshold", value: "2000000000" },
  { type: "approve_claim", claim_id: "clm_123" },
];

/** A mocked RPC: answers view calls from a table and records every call. */
function mockRpc(answers: Record<string, unknown>) {
  const calls: { contractId: string; method: string; args: Record<string, unknown> }[] = [];
  const provider = {
    callFunction: async ({ contractId, method, args }: { contractId: string; method: string; args: Record<string, unknown> }) => {
      calls.push({ contractId, method, args });
      if (!(method in answers)) throw new Error(`unexpected ${method}`);
      return answers[method];
    },
  } as unknown as ViewProvider;
  return { provider, calls };
}

const raw = (id: number, kind: SputnikProposal["kind"], status: SputnikProposal["status"] = "InProgress"): SputnikProposal => ({
  id,
  proposer: "alice.testnet",
  description: `p${id}`,
  kind,
  status,
  vote_counts: { council: [2, 1, 0] },
  votes: {},
  submission_time: "1794225600000000000",
});

describe("Wardline decisions as Sputnik proposals", () => {
  it.each(ACTIONS)("builds and decodes $type", (action) => {
    const input = buildProposal(action, contracts);
    expect(input.description.length).toBeGreaterThan(10);
    expect(decodeProposal(input.kind, contracts)).toEqual({ action, transfer: null });
  });

  it("funds a budget with a Transfer carrying msg, which Sputnik runs as ft_transfer_call to the meter", () => {
    const { kind } = buildProposal(ACTIONS[0]!, contracts);
    expect(kind).toEqual({ Transfer: { token_id: contracts.token, receiver_id: contracts.meter, amount: "25000000", msg: '{"action":"fund","budget_id":"bgt_aurora"}' } });
  });

  it("reads plain treasury payouts, by Transfer or by ft_transfer, as transfers", () => {
    expect(decodeProposal({ Transfer: { token_id: contracts.token, receiver_id: "northwind.testnet", amount: "5", msg: null } }, contracts).transfer).toMatchObject({ receiver_id: "northwind.testnet" });
    const ft = { FunctionCall: { receiver_id: contracts.token, actions: [{ method_name: "ft_transfer", args: Buffer.from(JSON.stringify({ receiver_id: "x.testnet", amount: "9" })).toString("base64"), deposit: "1", gas: "1" }] } };
    expect(decodeProposal(ft, contracts).transfer).toEqual({ token_id: contracts.token, receiver_id: "x.testnet", amount: "9", msg: null });
  });

  it("ignores proposals it does not understand", () => {
    expect(decodeProposal({ AddMemberToRole: { member_id: "eve.testnet", role: "council" } }, contracts)).toEqual({ action: null, transfer: null });
  });
});

describe("Sputnik client over mocked RPC", () => {
  it("lists recent proposals newest first, with decoded actions and vote counts", async () => {
    const rpc = mockRpc({ get_last_proposal_id: 2, get_proposals: [raw(0, buildProposal(ACTIONS[0]!, contracts).kind, "Approved"), raw(1, buildProposal(ACTIONS[1]!, contracts).kind)] });
    const client = createSputnikClient({ dao: DAO, contracts, provider: rpc.provider });
    const list = await client.listProposals({ limit: 10 });
    expect(rpc.calls.map((c) => [c.contractId, c.method, c.args])).toEqual([
      [DAO, "get_last_proposal_id", {}],
      [DAO, "get_proposals", { from_index: 0, limit: 10 }],
    ]);
    expect(list.map((p) => [p.id, p.status, p.action?.type, p.approvals, p.rejections])).toEqual([
      [1, "InProgress", "set_allowance", 2, 1],
      [0, "Approved", "fund_budget", 2, 1],
    ]);
    expect(list[0]!.submittedAt).toBe("2026-11-09T12:00:00.000Z");
  });

  it("builds add_proposal with the policy's bond, and act_proposal votes, for a wallet to sign", async () => {
    const rpc = mockRpc({ get_policy: { roles: [], proposal_bond: "100000000000000000000000", proposal_period: "1" } });
    const client = createSputnikClient({ dao: DAO, contracts, provider: rpc.provider });
    const tx = await client.proposeTx(ACTIONS[5]!, "Customer was paid to a stolen account");
    expect(tx.receiverId).toBe(DAO);
    expect(tx.actions[0]!.params).toMatchObject({ methodName: "add_proposal", deposit: "100000000000000000000000" });
    expect((tx.actions[0]!.params.args as { proposal: { description: string } }).proposal.description).toContain("Customer was paid to a stolen account");
    expect(client.voteTx(4, "VoteApprove").actions[0]!.params).toMatchObject({ methodName: "act_proposal", args: { id: 4, action: "VoteApprove" }, deposit: "0" });
  });

  it("returns null for a missing proposal", async () => {
    const client = createSputnikClient({ dao: DAO, contracts, provider: mockRpc({}).provider });
    expect(await client.getProposal(99)).toBeNull();
  });
});

describe("sim DAO", () => {
  it("passes a proposal at a council majority and answers the same views as the contract", async () => {
    const sim = createSimDao({ councilSize: 3 });
    const id = sim.propose("alice.testnet", buildProposal(ACTIONS[1]!, contracts), new Date("2026-11-09T00:00:00Z"));
    sim.act(id, "alice.testnet", "VoteApprove");
    const client = createSputnikClient({ dao: DAO, contracts, provider: sim.provider });
    expect((await client.getProposal(id))!.status).toBe("InProgress");
    sim.act(id, "bob.testnet", "VoteApprove");
    expect((await client.getProposal(id))!.status).toBe("Approved");
    expect(() => sim.act(id, "carol.testnet", "VoteReject")).toThrow(/NOT_READY/);
  });
});
