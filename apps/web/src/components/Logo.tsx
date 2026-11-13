import { BRAND } from "../brand";
import { HorizonMark } from "./HorizonMark";

/** The lockup: the Horizon mark a little taller than the wordmark, then "Wardline". Always links home. */
export function Logo({ textSize = 22 }: { textSize?: number }) {
  const mark = Math.round(textSize * 1.3);
  return (
    <a className="logo" href="#/" aria-label={BRAND.homeLabel}>
      {/* A coarse step at this size: the dots and the line stay readable, as in the favicon. */}
      <HorizonMark size={mark} {...(mark <= 32 ? { step: 15, light: [-0.2, -0.3] as [number, number] } : {})} />
      <span className="wordmark" style={{ fontSize: textSize }}>
        {BRAND.name}
      </span>
    </a>
  );
}
