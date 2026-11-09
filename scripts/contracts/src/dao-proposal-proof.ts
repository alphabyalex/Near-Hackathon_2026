import { join } from "node:path";
import { actions } from "near-api-js";
import { makeProvider, makeSigner } from "@wardline/vault-client";
import { CredentialStore, defaultSecretsDir } from "./lib.js";

async function main() {
  const provider = makeProvider("https://test.rpc.fastnear.com");
  const credPath = join(defaultSecretsDir("testnet"), "credentials.json");
  const creds = new CredentialStore(credPath);

  const rootId = "wardline-labs.testnet";
  const rootKey = creds.get(rootId);
  if (!rootKey) throw new Error("No root key");
  const rootSigner = makeSigner(provider, rootId, rootKey);

  const daoId = "dao.wardline-labs.testnet";
  const meterId = "meter.wardline-labs.testnet";

  const actionArgs = Buffer.from(JSON.stringify({ cover_fee_bps: 250 })).toString("base64");

  console.log("Submitting proposal to", daoId, "...");
  const res = await rootSigner.account.signAndSendTransaction({
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

  console.log("Proposal tx:", res.transaction.hash);
  console.log("Status:", res.status);
}

main().catch(console.error);
