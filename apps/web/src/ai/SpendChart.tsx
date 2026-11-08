import { useState } from "react";
import { formatUsdc } from "../format";

export interface SpendPoint {
  day: string;
  spent: string;
  verified: number;
  refused: number;
}

const W = 640;
const H = 140;
const PAD_B = 2;
const PAD_T = 10;

/**
 * Spend per day, one series. Thin ink bars anchored to the baseline with rounded tops and a 2px gap;
 * each bar has a hover and focus tooltip, and the same numbers are in a table for screen readers.
 */
export function SpendChart({ series, label }: { series: SpendPoint[]; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const values = series.map((p) => Number(BigInt(p.spent)));
  const max = Math.max(1, ...values);
  const slot = W / series.length;
  const bar = Math.max(3, Math.min(12, slot - 2));
  const plotH = H - PAD_B - PAD_T;
  const point = active === null ? null : series[active];
  return (
    <figure className="spend-chart">
      <div className="spend-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
          <line x1="0" x2={W} y1={H - PAD_B} y2={H - PAD_B} className="axis" />
          {series.map((p, i) => {
            const h = values[i]! === 0 ? 0 : Math.max(2, (values[i]! / max) * plotH);
            const x = i * slot + (slot - bar) / 2;
            return (
              <g key={p.day}>
                {h > 0 && <path className={active === i ? "bar on" : "bar"} d={roundedTop(x, H - PAD_B - h, bar, h, Math.min(4, bar / 2))} />}
                <rect
                  x={i * slot}
                  y={0}
                  width={slot}
                  height={H}
                  className="hit"
                  tabIndex={0}
                  aria-label={`${p.day}: ${formatUsdc(p.spent)} USDC, ${p.verified} verified, ${p.refused} refused`}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>
        <div className="spend-ticks" aria-hidden="true">
          {[0, Math.floor(series.length / 2), series.length - 1].map((i) => (
            <span key={i} style={{ left: `${((i + 0.5) / series.length) * 100}%` }}>
              {series[i]?.day.slice(5)}
            </span>
          ))}
        </div>
        {point && (
          <div className="spend-tip" style={{ left: `${((active! + 0.5) / series.length) * 100}%` }} role="status">
            <b>{point.day}</b>
            <span className="num">{formatUsdc(point.spent)} USDC</span>
            <span>
              {point.verified} verified, {point.refused} refused
            </span>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Spent (USDC)</th>
            <th>Verified</th>
            <th>Refused</th>
          </tr>
        </thead>
        <tbody>
          {series.map((p) => (
            <tr key={p.day}>
              <td>{p.day}</td>
              <td>{formatUsdc(p.spent)}</td>
              <td>{p.verified}</td>
              <td>{p.refused}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A bar whose top corners are rounded and whose base sits square on the axis. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}
