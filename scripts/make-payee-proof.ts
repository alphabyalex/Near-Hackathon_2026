// Run by a vendor, on their own machine, to produce /.well-known/redline-payee.json.
//
//   pnpm payee:proof --config payee.json --out redline-payee.json
//
// payee.json names each account and the environment variable that holds its private key, so keys
// never sit in a file:
//
//   {
//     "domain": "northwind.example",
//     "name": "Northwind Trading",
//     "accounts": [
//       { "account": "near:testnet:northwind.testnet", "private_key_env": "NEAR_PAYOUT_KEY" },
//       { "account": "eip155:84532:0xabc...", "private_key_env": "EVM_PAYOUT_KEY" },
//       { "account": "solana:devnet:7xKX...", "private_key_env": "SOLANA_PAYOUT_KEY" }
//     ]
//   }
//
// Key formats: NEAR ed25519:<base58>. EVM 0x<hex>. Solana base58 secret key.
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { normalizeDomain } from "@redline/sdk";
import { z } from "zod";
import { buildProofFile } from "../services/api/src/payee/proofs.js";

const Config = z.object({
  domain: z.string(),
  name: z.string().min(1).max(120),
  accounts: z.array(z.object({ account: z.string(), private_key_env: z.string() })).min(1),
});

const { values } = parseArgs({
  options: {
    config: { type: "string" },
    out: { type: "string", default: "redline-payee.json" },
  },
});

if (!values.config) {
  console.error("Usage: pnpm payee:proof --config payee.json [--out redline-payee.json]");
  process.exit(2);
}

const config = Config.parse(JSON.parse(readFileSync(values.config, "utf8")));
const domain = normalizeDomain(config.domain);
const file = await buildProofFile({
  domain,
  name: config.name,
  issuedAt: new Date().toISOString(),
  accounts: config.accounts.map(({ account, private_key_env }) => {
    const privateKey = process.env[private_key_env];
    if (!privateKey) throw new Error(`${private_key_env} is not set.`);
    return { account, privateKey };
  }),
});

writeFileSync(values.out ?? "redline-payee.json", `${JSON.stringify(file, null, 2)}\n`);
console.log(`Wrote ${values.out} with ${file.accounts.length} signed account(s).`);
console.log(`Serve it at https://${domain}/.well-known/redline-payee.json, then POST { "domain": "${domain}" } to /v1/vendors/verify.`);
