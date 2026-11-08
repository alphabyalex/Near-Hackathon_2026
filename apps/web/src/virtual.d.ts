declare module "virtual:redteam-summary" {
  interface Tally {
    unsafePayees: number;
    legitPaid: number;
  }
  const summary: {
    engine: { name: string; note: string };
    cases: { written: number; attacks: number; legit: number; adversarial: number };
    headline: { attackCatchRate: number; legitFalsePositiveRate: number; unsafePays: number; adversarialCatchRate: number; latencyP50Ms: number; latencyP95Ms: number };
    comparisons: { variant: string; model: string; cases: number; attacks: number; legitRecurring: number; agentAlone: Tally; agentWithRedline: Tally }[];
  };
  export default summary;
}

interface ImportMetaEnv {
  readonly VITE_REDLINE_API_URL?: string;
  readonly VITE_REDLINE_MCP_URL?: string;
  readonly VITE_REDLINE_OWNER_URL?: string;
  readonly VITE_NEAR_NETWORK?: string;
  readonly VITE_REDLINE_TEST_WALLET?: string;
}
