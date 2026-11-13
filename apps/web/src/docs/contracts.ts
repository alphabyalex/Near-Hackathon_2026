/** The accounts Wardline runs on, on NEAR testnet. The docs' Contracts page renders this list. */
export interface ContractRow {
  account: string;
  name: string;
  does: string;
}

export const CONTRACTS: readonly ContractRow[] = [
  { account: "meter.wardline-labs.testnet", name: "Meter", does: "Reserves, settles and releases every AI call. Holds budgets and allowances. Keeps each group's tier." },
  { account: "pool.wardline-labs.testnet", name: "Mutual pool", does: "Takes USDC deposits, mints WARD, pays claims, runs the sell wait and WARD-holder votes." },
  { account: "model-registry.wardline-labs.testnet", name: "Model registry", does: "Lists the signers attested for each model." },
  { account: "payee-registry.wardline-labs.testnet", name: "Payee registry", does: "Links a vendor's domain to its payout accounts, with a cooling-off period for new ones." },
  { account: "vault.wardline-labs.testnet", name: "Business vault", does: "Holds a business's payment authority, with Release Guard on changes to a vendor's payout account." },
  { account: "dao.wardline-labs.testnet", name: "DAO", does: "A Sputnik DAO v2 that governs budgets and allocations for the council group." },
];

export const nearblocksAccount = (account: string): string => `https://testnet.nearblocks.io/address/${account}`;
