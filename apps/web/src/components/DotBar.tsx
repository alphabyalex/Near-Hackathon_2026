const clamp = (value: number): number => Math.min(100, Math.max(0, value));

/** Settled dots are ink, reserved dots are amber and breathe, the red tick marks the cap. All values are percentages. */
export function DotBar({ settled, reserved = 0, cap = 100, delay = 0, label }: { settled: number; reserved?: number; cap?: number | null; delay?: number; label: string }) {
  const settledWidth = clamp(settled);
  const reservedWidth = Math.min(clamp(reserved), 100 - settledWidth);
  return (
    <div className="dots" role="img" aria-label={label}>
      <div className="fill" style={{ width: `${settledWidth}%`, animationDelay: `${delay}s` }} />
      {reservedWidth > 0 && <div className="res" style={{ left: `${settledWidth}%`, width: `${reservedWidth}%` }} />}
      {cap !== null && <div className="cap" style={cap >= 100 ? { left: "100%", marginLeft: -2 } : { left: `${clamp(cap)}%` }} />}
    </div>
  );
}
