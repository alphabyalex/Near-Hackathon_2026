import { BRAND } from "../brand";
import { HorizonMark } from "./HorizonMark";

/** The lockup: the Horizon mark at about 1.5x the wordmark's cap height, then "Wardline". Always links home. */
export function Logo({ textSize = 22 }: { textSize?: number }) {
  const mark = Math.round(textSize * 0.7 * 1.5);
  return (
    <a className="logo" href="#/" aria-label={BRAND.homeLabel}>
      <HorizonMark size={mark} />
      <span className="wordmark" style={{ fontSize: textSize }}>
        {BRAND.name}
      </span>
    </a>
  );
}
