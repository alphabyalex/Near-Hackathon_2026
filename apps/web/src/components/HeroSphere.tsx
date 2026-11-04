import type { CSSProperties } from "react";
import { HERO_DOTS } from "./data/dots";

const vars = (values: Record<string, string>): CSSProperties => values as CSSProperties;

/** Ghost dots twinkle, the red row pulses, the whole sphere drifts. All of it stops under reduced motion. */
export function HeroSphere() {
  return (
    <svg className="sphere" viewBox="0 0 100 100" role="img" aria-label="A sphere of dots cut flat by a red line. The dots above the line are switched off.">
      {HERO_DOTS.map((dot) => {
        const [cx, cy, r] = dot;
        const key = `${cx}-${cy}`;
        if (dot[3] === "g") return <circle key={key} className="gh" style={vars({ "--d": `${dot[4]}s`, "--o": `${dot[5]}s` })} cx={cx} cy={cy} r={r} fill="currentColor" opacity={0.13} />;
        if (dot[3] === "c") return <circle key={key} className="cut" style={vars({ "--o": `${dot[4]}s` })} cx={cx} cy={cy} r={r} />;
        return <circle key={key} cx={cx} cy={cy} r={r} fill="currentColor" />;
      })}
    </svg>
  );
}
