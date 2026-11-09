import { useId } from "react";
import type { WardPricePoint } from "../api/ai";
import { SHARE } from "../brand";

const W = 640;
const H = 220;
const PAD = { l: 8, r: 64, t: 16, b: 16 };
const price4 = (scaled: number) => (scaled / 1e6).toFixed(4);

/**
 * WARD's price since launch. A dashed line marks 1.0000, the launch price. The price line is light
 * above it and red below it (one path, two clip regions), and the latest price is a violet dot.
 */
export function PriceChart({ history, launch }: { history: WardPricePoint[]; launch: string }) {
  const id = useId().replace(/:/g, "");
  const base = Number(launch);
  const points = history.length > 0 ? history.map((p) => Number(p.price)) : [base];
  if (points.length === 1) points.push(points[0]!);
  const lo = Math.min(base, ...points);
  const hi = Math.max(base, ...points);
  const span = Math.max(hi - lo, base * 0.004);
  const yOf = (v: number) => PAD.t + (1 - (v - (lo - span * 0.15)) / (span * 1.3)) * (H - PAD.t - PAD.b);
  const xOf = (i: number) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(" ");
  const yBase = yOf(base);
  const last = points[points.length - 1]!;
  const lastX = xOf(points.length - 1);
  const summary = `${SHARE.chart}: ${price4(points[0]!)} to ${price4(last)} USDC over ${history.length} changes. Launch price 1.0000.`;
  return (
    <figure className="price-chart" data-testid="price-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        <defs>
          <clipPath id={`above-${id}`}>
            <rect x="0" y="0" width={W} height={yBase} />
          </clipPath>
          <clipPath id={`below-${id}`}>
            <rect x="0" y={yBase} width={W} height={H - yBase} />
          </clipPath>
        </defs>
        <line className="pc-launch" x1={PAD.l} x2={W - PAD.r} y1={yBase} y2={yBase} />
        <path className="pc-line pc-above" d={d} clipPath={`url(#above-${id})`} />
        <path className="pc-line pc-below" d={d} clipPath={`url(#below-${id})`} />
        <circle className="pc-dot" cx={lastX} cy={yOf(last)} r="5" />
      </svg>
      <div className="pc-labels" aria-hidden="true">
        <span className="pc-latest num" style={{ top: `${(yOf(last) / H) * 100}%` }}>
          {price4(last)}
        </span>
        <span className="pc-base num" style={{ top: `${(yBase / H) * 100}%` }}>
          1.0000
        </span>
      </div>
    </figure>
  );
}
