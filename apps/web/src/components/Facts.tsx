import type { ReactNode } from "react";

export function Facts({ rows }: { rows: [label: string, value: ReactNode][] }) {
  return (
    <dl className="factlist">
      {rows.map(([label, value]) => (
        <div className="fact" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
