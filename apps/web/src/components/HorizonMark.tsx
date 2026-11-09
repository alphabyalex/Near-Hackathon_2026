import { useMemo } from "react";
import { fingerprintCells, HORIZON_COLORS, horizonDots, MARK, seededLight, type HorizonOptions } from "../brand/horizon";

/** The Horizon mark from the shared generator. viewBox 0 0 220 220. */
export function HorizonMark({ size, variant = "light", light, step, className, label }: { size: number; variant?: "light" | "ink"; light?: [number, number]; step?: number; className?: string; label?: string }) {
  const dots = useMemo(() => horizonDots({ ...MARK, ...HORIZON_COLORS[variant], ...(light ? { light } : {}), ...(step ? { step } : {}) } as HorizonOptions), [variant, light?.[0], light?.[1], step]);
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 220 220" {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      {dots.map((d) => (
        <circle key={`${d.x}-${d.y}`} cx={d.x} cy={d.y} r={d.r} fill={d.fill} />
      ))}
    </svg>
  );
}

/** Each group's own horizon: the light angle comes from a hash of its budget id. */
export function GroupHorizon({ id, size = 56 }: { id: string; size?: number }) {
  return <HorizonMark size={size} light={seededLight(id)} step={20} className="group-horizon" />;
}

/**
 * A call's fingerprint: a 5x5 mirrored grid from a hash of its id. Light squares for a call above
 * the line, red for one below it.
 */
export function Fingerprint({ id, side, size = 22 }: { id: string; side: "above" | "below"; size?: number }) {
  const cells = useMemo(() => fingerprintCells(id), [id]);
  return (
    <svg className={`fingerprint fp-${side}`} width={size} height={size} viewBox="0 0 25 25" aria-hidden="true">
      {cells.map((on, i) => (on ? <rect key={i} x={(i % 5) * 5 + 0.5} y={Math.floor(i / 5) * 5 + 0.5} width="4" height="4" /> : null))}
    </svg>
  );
}
