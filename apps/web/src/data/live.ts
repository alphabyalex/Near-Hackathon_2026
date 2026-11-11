/**
 * The home hero's live numbers and latest payment, refreshed every few seconds.
 * testnet: /v1/activity/stats and /v1/activity. sim: the same numbers from /v1/mutual and the
 * simulation's proofs, so the hero looks the same with no live label.
 */
import { useEffect, useState } from "react";
import { getMutual } from "../api/ai";
import { modelName } from "../ai/words";
import { HOME } from "../brand";
import { getActivity, getActivityStats, type ActivityItem } from "./activity";
import { DATA_SOURCE } from "./source";

export interface LiveNumbers {
  /** Atomic USDC. */
  pooled: string;
  /** USDC per WARD, scaled by 1e6. */
  price: string;
  launch: string;
  paid: number;
  kept: number;
}

export interface LiveProof {
  key: string;
  who: string;
  model: string | null;
  side: "above" | "below";
  verdict: string;
  /** "0.0002 USDC", or null when nothing moved. */
  amount: string | null;
  explorer: string | null;
}

/** /v1/activity rows carry more than ActivityItem types: the actor, model, outcome and explorer link. */
type Row = ActivityItem & { actor?: string; model?: string | null; outcome?: string | null; explorer_url?: string; tx_hash?: string | null };

export async function getLiveNumbers(): Promise<LiveNumbers> {
  const s = DATA_SOURCE === "testnet" ? await getActivityStats() : (await getMutual()).stats;
  return { pooled: s.total_pooled, price: s.ward_price, launch: s.launch_price ?? "1000000", paid: s.proven_payments, kept: s.below.total };
}

const usdc4 = (atomic: string | null): string | null => {
  if (!atomic || !/^\d+$/.test(atomic) || atomic === "0") return null;
  return `${(Number(atomic) / 1e6).toFixed(4)} USDC`;
};

/** One activity row as the hero's latest-payment line. Only AI calls count as payments here. */
export function toProof(row: Row): LiveProof | null {
  if (row.kind !== "call") return null;
  const v = HOME.live.verdict;
  const verdict = row.side === "above" ? v.paid : row.outcome === "capped" ? v.capped : row.outcome === "blocked" ? v.blocked : v.refused;
  const who = row.text.includes(":") ? row.text.slice(0, row.text.indexOf(":")) : (row.actor ?? row.text);
  const hash = row.tx_hash ?? row.tx;
  return {
    key: `${row.at}|${hash ?? row.text}`,
    who,
    model: row.model ? modelName(row.model) : null,
    side: row.side,
    verdict,
    amount: row.side === "above" ? usdc4(row.amount) : null,
    explorer: row.explorer_url ?? (hash && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash) ? `https://testnet.nearblocks.io/txns/${hash}` : null),
  };
}

export async function getLatestProof(): Promise<LiveProof | null> {
  const rows = (await getActivity(20)) as Row[];
  for (const r of rows) {
    const p = toProof(r);
    if (p) return p;
  }
  return null;
}

export const LIVE_REFRESH_MS = 12_000;

/** Polls both, every 12 seconds, while the page is open. A failed refresh keeps the last good values. */
export function useLiveHero(intervalMs = LIVE_REFRESH_MS): { numbers: LiveNumbers | null; proof: LiveProof | null; error: unknown } {
  const [numbers, setNumbers] = useState<LiveNumbers | null>(null);
  const [proof, setProof] = useState<LiveProof | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      getLiveNumbers().then(
        (n) => {
          if (!live) return;
          setNumbers((old) => (old && JSON.stringify(old) === JSON.stringify(n) ? old : n));
          setError(null);
        },
        (e: unknown) => live && setError(e),
      );
      getLatestProof().then(
        (p) => live && setProof((old) => (old?.key === p?.key ? old : p)),
        () => undefined,
      );
    };
    load();
    const timer = setInterval(load, intervalMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [intervalMs]);
  return { numbers, proof, error };
}
