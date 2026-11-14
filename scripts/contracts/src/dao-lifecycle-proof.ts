import { join } from "node:path";
import { actions } from "near-api-js";
import { makeProvider, makeSigner } from "@wardline/vault-client";
import { CredentialStore, defaultSecretsDir, readWasm, Deployer } from "./lib.js";

const NEAR = 1_000_000_000_000_000_000_000_000n;

async function main() {
  const provider = makeProvider("https://test.rpc.fastnear.com");
  const credPath = join(defaultSecretsDir("testnet"), "credentials.json");
  const creds = new CredentialStore(credPath);

  const rootId = "wardline-labs.testnet";
  const rootKey = creds.get(rootId);
  if (!rootKey) throw new Error("No root key");
  const rootSigner = makeSigner(provider, rootId, rootKey);

  const daoId = `dao.${rootId}`;
  const daoKey = creds.get(daoId);
  if (!daoKey) throw new Error("No dao key");
  const daoSigner = makeSigner(provider, daoId, daoKey);

  const investor1Id = `investor1.${rootId}`;
  const investor1Key = creds.get(investor1Id);
  if (!investor1Key) throw new Error("No investor1 key");
  const investor1Signer = makeSigner(provider, investor1Id, investor1Key);

  const meterId = `meter.${rootId}`;

  console.log("Step 1: Checking if dao account exists...");
  try {
    const acc = await provider.query({
      request_type: "view_account",
      finality: "final",
      account_id: daoId,
    });
    if (acc) {
      console.log("Deleting existing dao account...");
      await daoSigner.account.signAndSendTransaction({
        receiverId: daoId,
        actions: [actions.deleteAccount(rootId)],
        waitUntil: "FINAL",
      });
      console.log("Old dao account deleted.");
      await new Promise((r) => setTimeout(r, 3000));
    }
  } catch (err: any) {
    console.log("Account does not exist or already deleted, continuing.");
  }

  console.log("Step 2: Re-creating dao account using Deployer...");
  const deployer = new Deployer("testnet", "https://test.rpc.fastnear.com", creds);
  await deployer.ensureAccount(daoId, rootSigner, 6500n * (NEAR / 1000n));
  console.log("Recreated dao account.");

  console.log("Step 3: Deploying Sputnik DAO v2 wasm...");
  const wasm = readWasm("sputnikdao2");
  const council = [rootId, investor1Id, `investor2.${rootId}`];

  await daoSigner.account.signAndSendTransaction({
    receiverId: daoId,
    actions: [
      actions.deployContract(wasm),
      actions.functionCall(
        "new",
        {
          config: {
            name: "wardline-dao",
            purpose: "Wardline payment authority and risk governance",
            metadata: "",
          },
          policy: {
            roles: [
              {
                name: "council",
                kind: { Group: council },
                permissions: [
                  "*:VoteReject",
                  "*:VoteRemove",
                  "*:VoteApprove",
                  "*:AddProposal",
                  "*:Finalize",
                ],
                vote_policy: {},
              },
            ],
            default_vote_policy: {
              weight_kind: "RoleWeight",
              quorum: "0",
              threshold: [1, 2],
            },
            proposal_bond: "10000000000000000000000",
            proposal_period: "604800000000000",
            bounty_bond: "10000000000000000000000",
            bounty_forgiveness_period: "86400000000000",
          },
        },
        100_000_000_000_000n,
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  console.log("DAO initialized with council:", council);

  console.log("Step 4: Proposing cover fee change to 2.5% (250 bps)...");
  const actionArgs = Buffer.from(JSON.stringify({ cover_fee_bps: 250 })).toString("base64");
  const propRes = await rootSigner.account.signAndSendTransaction({
    receiverId: daoId,
    actions: [
      actions.functionCall(
        "add_proposal",
        {
          proposal: {
            description: "propose changing meter's cover fee to 2.5%",
            kind: {
              FunctionCall: {
                receiver_id: meterId,
                actions: [
                  {
                    method_name: "set_cover_fee_bps",
                    args: actionArgs,
                    deposit: "0",
                    gas: "100000000000000",
                  },
                ],
              },
            },
          },
        },
        150_000_000_000_000n,
        10_000_000_000_000_000_000_000n, // 0.01 NEAR bond
      ),
    ],
    waitUntil: "FINAL",
  });
  const propTx = propRes.transaction.hash;
  console.log("Proposal tx:", propTx);

  // Proposal ID is 0
  const proposalId = 0;

  console.log("Step 5: Voting 1/3 (root)...");
  const vote1Res = await rootSigner.account.signAndSendTransaction({
    receiverId: daoId,
    actions: [
      actions.functionCall(
        "act_proposal",
        {
          id: proposalId,
          action: "VoteApprove",
        },
        200_000_000_000_000n,
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  console.log("Vote 1 tx:", vote1Res.transaction.hash);

  console.log("Step 6: Voting 2/3 (investor1) to reach threshold and execute...");
  const vote2Res = await investor1Signer.account.signAndSendTransaction({
    receiverId: daoId,
    actions: [
      actions.functionCall(
        "act_proposal",
        {
          id: proposalId,
          action: "VoteApprove",
        },
        250_000_000_000_000n,
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  const execTx = vote2Res.transaction.hash;
  console.log("Vote 2 / Execution tx:", execTx);

  console.log("Step 7: Verifying meter cover fee updated to 250 bps...");
  const newFee = await provider.query({
    request_type: "call_function",
    finality: "final",
    account_id: meterId,
    method_name: "get_cover_fee_bps",
    args_base64: Buffer.from("{}").toString("base64"),
  });
  const decodedFee = JSON.parse(Buffer.from((newFee as any).result).toString());
  console.log("Current cover_fee_bps on meter:", decodedFee);

  if (decodedFee === 250) {
    console.log("SUCCESS! DAO Proposal 2-of-3 vote flow completed and verified!");
  } else {
    console.error("FAIL: Expected 250, got", decodedFee);
  }
}

main().catch(console.error);
