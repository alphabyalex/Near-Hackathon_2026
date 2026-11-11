/**
 * A number that rolls to its new value: each changed digit slides up out of its slot as the new one
 * slides in, once. At rest it is plain text. Under reduced motion it simply changes.
 */
import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./motion";

export const ROLL = {
  /** How long one roll takes, in ms (CSS uses the same number through --roll-ms). */
  ms: 650,
  /** Each changed digit starts this much after the one to its right, in ms. */
  staggerMs: 40,
} as const;

export interface RollSlot {
  /** The character that was in this slot, or null when the new value is longer. */
  from: string | null;
  to: string;
  changed: boolean;
}

/** The slots for a roll from one formatted value to the next, right-aligned like tabular figures. */
export function rollPlan(prev: string, next: string): RollSlot[] {
  const pad = Math.max(0, next.length - prev.length);
  const from = prev.length > next.length ? prev.slice(prev.length - next.length) : prev;
  return [...next].map((to, i) => {
    const f = i < pad ? null : (from[i - pad] ?? null);
    return { from: f, to, changed: f !== to };
  });
}

/** Plain text at rest; while rolling, the new value for screen readers and the slots for the eye. */
export function Rolling({ value, className }: { value: string; className?: string }) {
  const [roll, setRoll] = useState<{ from: string; to: string; n: number } | null>(null);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current === value) return;
    const from = prev.current;
    prev.current = value;
    if (prefersReducedMotion()) return;
    setRoll((r) => ({ from, to: value, n: (r?.n ?? 0) + 1 }));
    const done = setTimeout(() => setRoll(null), ROLL.ms + ROLL.staggerMs * value.length + 50);
    return () => clearTimeout(done);
  }, [value]);

  if (!roll || roll.to !== value) return <span className={className}>{value}</span>;
  const slots = rollPlan(roll.from, roll.to);
  let order = 0;
  const delays = slots.map((s) => s.changed).reverse().map((c) => (c ? order++ : 0)).reverse();
  return (
    <span className={className ? `${className} rolling` : "rolling"} data-rolling="true">
      <span className="sr-only">{value}</span>
      <span className="roll" aria-hidden="true" style={{ ["--roll-ms" as string]: `${ROLL.ms}ms` }}>
        {slots.map((s, i) =>
          s.changed ? (
            <span key={`${roll.n}-${i}`} className="roll-slot">
              <span className="roll-col" style={{ animationDelay: `${delays[i]! * ROLL.staggerMs}ms` }}>
                <span>{s.from ?? " "}</span>
                <span>{s.to}</span>
              </span>
            </span>
          ) : (
            <span key={i} className="roll-still">
              {s.to}
            </span>
          ),
        )}
      </span>
    </span>
  );
}
