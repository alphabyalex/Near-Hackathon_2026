import type { InvoiceSummary, OverviewView, ReviewQueueEntry } from "@wardline/schemas";
import { useApi } from "../api/client";
import { AiSpend } from "./owner/AiSpend";
import { lifetimeBar, weeklyBar, type LimitBar } from "../api/limits";
import { useScore } from "../api/scoring";
import { DecisionTable } from "../components/DecisionTable";
import { DotBar } from "../components/DotBar";
import { LoadError, Loading } from "../components/Loading";
import { Money } from "../components/Money";
import { Panel } from "../components/Panel";
import { ReviewQueue } from "../components/ReviewQueue";
import { Status } from "../components/Status";
import { dueIn, formatShort, nowNs, shortDigest } from "../format";

const RECENT_DECISIONS = 5;

const OUTCOME_NOTE = {
  MET_THRESHOLDS: { text: "met thresholds", color: "var(--text)" },
  BELOW_THRESHOLDS: { text: "below thresholds", color: "var(--red-text)" },
  NOT_ASSESSED: { text: "not assessed", color: "var(--muted)" },
} as const;

function waitingNote(queue: readonly ReviewQueueEntry[]): string | null {
  const soon = queue.filter((item) => item.due_within_48h);
  const [first] = soon;
  if (!first) return null;
  if (soon.length > 1) return `${soon.length} due within 48 hours`;
  const left = dueIn(first.due_at_ns, nowNs());
  return left === "overdue" ? "1 overdue" : `1 due in ${left}`;
}

function Meter({ bar, delay = 0, legend }: { bar: LimitBar; delay?: number; legend?: React.ReactNode }) {
  return (
    <div className="meter">
      <div className="top-line">
        <span>{bar.title}</span>
        <span className="num">{bar.value}</span>
      </div>
      <DotBar settled={bar.settled} reserved={bar.reserved} cap={bar.cap} delay={delay} label={`${bar.title}: ${bar.value}`} />
      {legend}
    </div>
  );
}

function LimitsPanel({ data }: { data: OverviewView }) {
  const { policy, usage, vendors, token } = data;
  return (
    <div className="panel pb">
      <h2 style={{ marginBottom: 22 }}>Limits</h2>
      <Meter
        bar={weeklyBar(policy, usage, token.decimals)}
        legend={
          <div className="legend">
            <span>settled {formatShort(usage.weekly_settled_atomic, token.decimals)}</span>
            <b>reserved {formatShort(usage.weekly_reserved_atomic, token.decimals)}</b>
          </div>
        }
      />
      <Meter bar={lifetimeBar(policy, usage, token.decimals)} delay={0.15} />
      <div style={{ marginTop: 26, borderTop: "1px solid var(--rule)", paddingTop: 10 }}>
        {vendors.map((vendor) => (
          <div className="kv" key={vendor.vendor_id}>
            <span>{vendor.display_name}</span>
            <span>{formatShort(vendor.per_payment_cap_atomic, token.decimals)} per payment</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EvaluationPanel({ version }: { version: number }) {
  const score = useScore(version);
  const note = score.outcome ? OUTCOME_NOTE[score.outcome] : { text: "not run yet", color: "var(--muted)" };
  return (
    <div className="panel pb">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <h2>Latest evaluation</h2>
        <span style={{ fontSize: 13, color: note.color }}>{note.text}</span>
      </div>
      <div className="kv">
        <span>Eligible bills paid</span>
        <span>{score.eligible}</span>
      </div>
      <div className="kv">
        <span>Unsafe proposals</span>
        <span>{score.unsafe}</span>
      </div>
      <div className="kv">
        <span>Stopped by the vault</span>
        <span>{score.stopped}</span>
      </div>
      <div className="kv">
        <span>Suite fingerprint</span>
        <span {...(score.fingerprintFull ? { title: score.fingerprintFull } : {})}>{score.fingerprint}</span>
      </div>
    </div>
  );
}

/** Money that left for the vault and has not resolved. The reference has no slot for this, so it only shows when there is some. */
function UnresolvedPanel({ data }: { data: OverviewView }) {
  if (data.unresolved_payments.length === 0) return null;
  return (
    <Panel title="Unresolved payments" note="Still reserved or unknown">
      <div className="scrollx">
        <table className="rows">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Payable</th>
              <th>Status</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.unresolved_payments.map((p) => (
              <tr key={p.intake_ref}>
                <td>
                  <a href={`#/app/invoices/${encodeURIComponent(p.intake_ref)}`}>{p.intake_ref}</a>
                </td>
                <td className="code">{p.payable_ref}</td>
                <td>
                  <Status status={p.payment_status} />
                </td>
                <td className="num">
                  <Money atomic={p.amount_atomic} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function Overview({ data, version, onChanged }: { data: OverviewView; version: number; onChanged: () => void }) {
  const queue = useApi<ReviewQueueEntry[]>("/owner/review-queue", version);
  const invoices = useApi<InvoiceSummary[]>("/owner/invoices", version);
  const { manifest, binding, policy, usage, headroom, token } = data;
  const note = queue.data ? waitingNote(queue.data) : null;
  const recent = [...(invoices.data ?? [])].sort((a, b) => Number(BigInt(b.received_at_ns) - BigInt(a.received_at_ns))).slice(0, RECENT_DECISIONS);

  return (
    <>
      <AiSpend version={version} />
      <div className="strip">
        <div>
          <div className="l">In the vault</div>
          <div className="v num">
            <Money atomic={usage.balance_atomic} />
          </div>
          <div className="s">{token.symbol}</div>
        </div>
        <div>
          <div className="l">Left this week</div>
          <div className="v num">
            <Money atomic={headroom.weekly_atomic} />
          </div>
          <div className="s">
            of <Money atomic={policy.weekly_cap_atomic} />
          </div>
        </div>
        <div>
          <div className="l">Waiting on you</div>
          <div className="v num">{queue.data?.length ?? "[ ]"}</div>
          <div className={note ? "s warn" : "s"}>{note ?? "none due soon"}</div>
        </div>
        <div>
          <div className="l">Agent</div>
          <div className="v">Version {manifest.version}</div>
          <div className="s" {...(binding ? { title: binding.manifest_digest } : {})}>
            manifest {binding ? shortDigest(binding.manifest_digest) : "[ digest ]"}
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="stack">
          <ReviewQueue queue={queue} onChanged={onChanged} />
          <Panel title="Recent decisions" note={`Agent version ${manifest.version}`}>
            {invoices.error && (
              <div className="pb">
                <LoadError message={invoices.error} />
              </div>
            )}
            {!invoices.error && !invoices.data && (
              <div className="pb">
                <Loading />
              </div>
            )}
            {invoices.data?.length === 0 && <p className="empty">No decisions yet.</p>}
            {recent.length > 0 && <DecisionTable invoices={recent} />}
          </Panel>
          <UnresolvedPanel data={data} />
        </div>
        <aside className="side">
          <LimitsPanel data={data} />
          <EvaluationPanel version={version} />
        </aside>
      </div>
    </>
  );
}
