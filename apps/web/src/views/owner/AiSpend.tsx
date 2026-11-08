import { useApi } from "../../api/client";
import type { AiOverview } from "../../api/ai";
import { SpendChart } from "../../ai/SpendChart";
import { AI } from "../../brand";
import { LoadError, Loading } from "../../components/Loading";
import { Panel } from "../../components/Panel";
import { formatWusd } from "../../format";

/** Dashboard panel: verified calls, refunds and spend over time for metered AI calls. */
export function AiSpend({ version }: { version: number }) {
  const { data, error } = useApi<AiOverview>("/owner/ai/overview", version);
  if (error) return <LoadError message={error} />;
  if (!data) return <Loading />;
  return (
    <div className="ai-panel">
    <Panel title={AI.title} note={AI.seriesNote} padded>
      <div className="strip ai-strip">
        <div>
          <div className="l">{AI.verified}</div>
          <div className="v num">{data.verifiedCalls}</div>
        </div>
        <div>
          <div className="l">{AI.refused}</div>
          <div className="v num">{data.refusedCalls + data.failedCalls}</div>
        </div>
        <div>
          <div className="l">{AI.spent}</div>
          <div className="v num">{formatWusd(data.spent)}</div>
          <div className="s">WUSD</div>
        </div>
        <div>
          <div className="l">{AI.refunded}</div>
          <div className="v num">{formatWusd(data.refunded)}</div>
          <div className="s">WUSD</div>
        </div>
      </div>
      {data.verifiedCalls + data.refusedCalls + data.failedCalls === 0 ? <p className="empty">{AI.empty}</p> : <SpendChart series={data.series} label={AI.series} />}
    </Panel>
    </div>
  );
}
