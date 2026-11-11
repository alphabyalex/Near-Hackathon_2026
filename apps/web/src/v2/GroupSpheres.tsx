/**
 * Groups as spheres (docs/design/v2/Groups.dc.html). Each group is a real button: its size comes from
 * its proven calls, its dot density from its tier, and the spheres assemble one after another. The
 * selected group gets a faint ring, and the row below shows its record and progress to the next tier.
 * On phones the sphere row scrolls in its own box.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { GroupSummary } from "../api/ai";
import { REP, SPHERES, GROUPS } from "../brand";
import { getCommunity } from "../data/groups";
import { DATA_SOURCE } from "../data/source";
import { frozenFrame, useCanvasAnimation } from "./motion";
import { fitCanvas, GROUP_SPHERE, groupSphere, LIGHT, paintDots, sphereDots, easeOut, type Tier } from "./sphere";

/** Assembly timing, in seconds, and the selection ring. Sizes live in GROUP_SPHERE (sphere.ts). */
export const GROUPS_MOTION = {
  delay: 0.2,
  stagger: 0.22,
  assemble: 1.6,
  ring: "rgba(123,108,255,0.55)",
  ringWidth: 1.2,
  phoneBelow: 600,
} as const;

const phoneQuery = `(max-width: ${GROUPS_MOTION.phoneBelow - 0.02}px)`;
function usePhone(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia?.(phoneQuery);
      mq?.addEventListener?.("change", notify);
      return () => mq?.removeEventListener?.("change", notify);
    },
    () => window.matchMedia?.(phoneQuery).matches === true,
    () => false,
  );
}

const tierOf = (t: string): Tier => (t === "gold" || t === "silver" ? t : "bronze");

/** The latest audited transaction of a community, read only with the testnet data source. */
function useLatestTx(id: string | null): string | null {
  const [tx, setTx] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!id || DATA_SOURCE !== "testnet") return;
    let live = true;
    getCommunity(id).then(
      (r) => {
        const row = r.recent_activity.find((a) => a.tx) as ((typeof r.recent_activity)[number] & { explorer_url?: string }) | undefined;
        if (live) setTx(row?.tx ? { id, url: row.explorer_url ?? `https://testnet.nearblocks.io/txns/${row.tx}` } : null);
      },
      () => live && setTx(null),
    );
    return () => {
      live = false;
    };
  }, [id]);
  return tx && tx.id === id ? tx.url : null;
}

function Detail({ g }: { g: GroupSummary }) {
  const tier = REP.names[tierOf(g.tier)];
  const latest = useLatestTx(g.budget_id);
  const top = g.next_tier_at === null;
  const nextTier = g.tier === "bronze" ? REP.names.silver : REP.names.gold;
  const progress = top ? 1 : Math.min(1, g.clean_calls / Math.max(1, g.next_tier_at!));
  return (
    <div className="orb-detail" data-testid="group-detail" data-budget={g.budget_id}>
      <div>
        <p className="orb-k">{SPHERES.selected}</p>
        <p className="orb-name">{g.name}</p>
        <p className="orb-line">
          <span className="tier-name">{tier}</span> {SPHERES.tierRest(GROUPS.members(g.members))}
        </p>
      </div>
      <div>
        <p className="orb-k">{SPHERES.record}</p>
        <p className="orb-big num">{SPHERES.proven(g.proven_calls)}</p>
        <p className="orb-line">{SPHERES.recordLine(g.refused_calls, g.claims)}</p>
      </div>
      <div>
        <p className="orb-k">{SPHERES.toward}</p>
        <div className="orb-bar" role="img" aria-label={top ? SPHERES.top : SPHERES.next(g.clean_calls, g.next_tier_at!, nextTier)}>
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <p className="orb-line">{top ? SPHERES.top : SPHERES.next(g.clean_calls, g.next_tier_at!, nextTier)}</p>
        {latest && (
          <a className="orb-tx" href={latest} target="_blank" rel="noreferrer">
            {SPHERES.latest}
          </a>
        )}
      </div>
    </div>
  );
}

export function GroupSpheres({ groups }: { groups: GroupSummary[] }) {
  const sorted = [...groups].sort((a, b) => b.proven_calls - a.proven_calls || a.name.localeCompare(b.name));
  const [sel, setSel] = useState(0);
  const phone = usePhone();
  const max = Math.max(1, ...sorted.map((g) => g.proven_calls));
  const specs = sorted.map((g) => groupSphere(g.proven_calls, max, tierOf(g.tier), phone ? GROUP_SPHERE.phoneScale : 1));
  const row = useRef<HTMLDivElement>(null);
  const canvases = useRef<Array<HTMLCanvasElement | null>>([]);
  const last = useRef(99);
  const selRef = useRef(sel);
  selRef.current = sel;
  const specsRef = useRef(specs);
  specsRef.current = specs;

  const draw = useCallback((t: number) => {
    last.current = t;
    specsRef.current.forEach((s, i) => {
      const cv = canvases.current[i];
      if (!cv) return;
      const S = s.R * 2 + GROUP_SPHERE.pad * 2;
      const ctx = fitCanvas(cv, S, S);
      if (!ctx) return;
      const as = Math.max(0, Math.min(1, (t - GROUPS_MOTION.delay - i * GROUPS_MOTION.stagger) / GROUPS_MOTION.assemble));
      if (selRef.current === i && as >= 1) {
        ctx.strokeStyle = GROUPS_MOTION.ring;
        ctx.lineWidth = GROUPS_MOTION.ringWidth;
        ctx.beginPath();
        ctx.arc(S / 2, S / 2, s.R + GROUP_SPHERE.ringOffset, 0, Math.PI * 2);
        ctx.stroke();
      }
      paintDots(ctx, sphereDots({ cx: S / 2, cy: S / 2, R: s.R, step: s.step, light: LIGHT, floor: s.floor, gap: s.gap }), s.R, easeOut(as));
    });
  }, []);
  const duration = GROUPS_MOTION.delay + Math.max(0, sorted.length - 1) * GROUPS_MOTION.stagger + GROUPS_MOTION.assemble;
  useCanvasAnimation(row, draw, { duration, freezeAt: frozenFrame("groups") });
  // A new selection or a new size redraws the current frame.
  useEffect(() => draw(last.current), [sel, phone, draw]);

  const g = sorted[sel];
  if (!g) return null;
  return (
    <section className="sec tight orbs-sec" aria-label={SPHERES.rowLabel}>
      <div className="wrap">
        <div className="orbs" ref={row} role="group" aria-label={SPHERES.rowLabel} data-testid="group-spheres">
          {sorted.map((d, i) => {
            const s = specs[i]!;
            const S = s.R * 2 + GROUP_SPHERE.pad * 2;
            const tier = REP.names[tierOf(d.tier)];
            return (
              <button key={d.budget_id} type="button" className="orb" aria-pressed={sel === i} onClick={() => setSel(i)} data-budget={d.budget_id} data-tier={d.tier}>
                <canvas
                  ref={(el) => {
                    canvases.current[i] = el;
                  }}
                  aria-hidden="true"
                  style={{ width: S, height: S }}
                />
                <span className="orb-label">
                  <span className="orb-title">{d.name}</span>
                  <span className="orb-meta">
                    <span className="tier-name">{tier}</span>, {SPHERES.proven(d.proven_calls)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <Detail g={g} />
      </div>
    </section>
  );
}
