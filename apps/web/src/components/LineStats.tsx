import type { ReactNode } from "react";

export interface LineStat {
  /** Small muted line above the number (optional). */
  label?: ReactNode;
  value: ReactNode;
  /** One short plain label under the number. */
  note: ReactNode;
  /** An optional quieter second line. */
  sub?: ReactNode;
}

function Side({ stat, className }: { stat: LineStat; className: string }) {
  return (
    <div className={className}>
      {stat.label && <p className="ls-label">{stat.label}</p>}
      <p className="ls-num">{stat.value}</p>
      <p className="ls-note">{stat.note}</p>
      {stat.sub && <p className="ls-sub">{stat.sub}</p>}
    </div>
  );
}

/**
 * "The line is the layout" (docs/design/v2/Cards.dc.html, option 6): a paired stat block with no box. The -10°
 * line runs across the section; the good number sits above it top-left, the red one below it bottom-right.
 * Screen readers read the good side first, then the side below the line.
 */
export function LineStats({ good, bad, label, testId }: { good: LineStat; bad: LineStat; label: string; testId?: string }) {
  return (
    <div className="linestats" role="group" aria-label={label} {...(testId ? { "data-testid": testId } : {})}>
      <Side stat={good} className="ls-good" />
      <Side stat={bad} className="ls-bad" />
    </div>
  );
}
