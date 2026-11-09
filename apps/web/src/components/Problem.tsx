import { ERRORS } from "../brand";
import { explain } from "../data/errors";

/** A failure in the Horizon voice: what happened, what to do next, and Try again when it may help. */
export function Problem({ error, onRetry, compact = false }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const e = explain(error);
  return (
    <div className={compact ? "problem compact" : "problem"} role="alert" data-problem={e.kind}>
      <b>{e.title}</b>
      <span>{e.next}</span>
      {e.retry && onRetry && (
        <button type="button" className="btn ghost sm" onClick={onRetry}>
          {ERRORS.retry}
        </button>
      )}
    </div>
  );
}
