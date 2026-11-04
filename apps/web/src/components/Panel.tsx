import type { ReactNode } from "react";

/** Dashboard panel with a title row. Set padded for content that is not a full-width table. */
export function Panel({ title, note, padded = false, children }: { title: ReactNode; note?: ReactNode; padded?: boolean; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="ph">
        <h2>{title}</h2>
        {note && <span>{note}</span>}
      </div>
      {padded ? <div className="pb">{children}</div> : children}
    </section>
  );
}
