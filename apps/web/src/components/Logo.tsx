import { BRAND } from "../brand";
import { MARK_DOTS } from "./data/dots";

/** The Eclipse mark, inlined so the dots take currentColor. The cut row stays red. */
export function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      {MARK_DOTS.map(([cx, cy, r, kind]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} className={kind === "c" ? "mark-cut" : ""} fill="currentColor" {...(kind === "g" ? { opacity: 0.16 } : {})} />
      ))}
    </svg>
  );
}

/** Always links home. */
export function Logo({ markSize = 30, textSize = 23 }: { markSize?: number; textSize?: number }) {
  return (
    <a className="logo" href="#/" aria-label={BRAND.homeLabel}>
      <Mark size={markSize} />
      <span className="wordmark" style={{ fontSize: textSize }}>
        {BRAND.name}
      </span>
    </a>
  );
}
