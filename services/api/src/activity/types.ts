import type { ClaimView, MutualProposalView, PoolPosition, PoolView } from "../chain/types.js";

export interface MutualSummary {
  pool: PoolView;
  claims: ClaimView[];
  governance: {
    proposals: MutualProposalView[];
    voting_period_days: number;
    vote_threshold_bps: number;
    quorum_bps: number;
    timelock_days: number;
  };
}

export interface ActivityItem {
  at: string;
  actor: string;
  community: string;
  kind: "call" | "payout" | "price" | "deposit" | "redeem" | "vote" | "proposal";
  side: "above" | "below";
  text: string;
  amount: string | null;
  model: string | null;
  outcome: "paid" | "refused" | "blocked" | "capped" | "voted" | "executed";
  reason: string | null;
  tx: string | null;
  block_height: number;
  explorer_url: string | null;
}

export interface ActivityStats {
  total_pooled: string;
  ward_price: string;
  launch_price: string;
  yield_earned: string;
  groups_covered: number;
  proven_payments: number;
  payouts: number;
  price_history: Array<{ at: string; price: string; event: string }>;
  below: {
    swapped: number;
    lookalike: number;
    capped: number;
    total: number;
  };
  paid_above: number;
  kept_below: {
    swapped: number;
    lookalike: number;
    capped: number;
    total: number;
  };
  fees_earned: string;
  claims: {
    count: number;
    total: string;
  };
}

export interface CommunitySummary {
  id: string;
  name: string;
  owner: string;
  members: string[];
  budget: {
    deposit: string;
    spent: string;
    reserved: string;
    period: string;
  };
  tier: string;
  tier_history: Array<{ at: string; tier: string }>;
  proven_calls: number;
  clean_calls: number;
  refused_calls: number;
  capped_calls: number;
  blocked_payees: number;
  fees_paid: string;
}

export interface MemberVote {
  id: number;
  support: "for" | "against";
  weight: string;
}

export interface PersonView {
  account: string;
  position: PoolPosition;
  mutual: MutualSummary;
  votes: MemberVote[];
  weights: Record<number, string>;
  open: MutualProposalView[];
  history: ActivityItem[];
}
