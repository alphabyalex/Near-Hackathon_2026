/** My share: the signed-in account's WARD, the price since launch, voting, and every change in WARD's price. */
import { useEffect, useState } from "react";
import type { MutualSummary, PoolPosition } from "../../api/ai";
import { errorText } from "../../api/public";
import { getMutual, getPosition } from "../../data/mutual";
import { SHARE } from "../../brand";
import { HorizonMark } from "../../components/HorizonMark";
import { LoadError, Loading } from "../../components/Loading";
import { PriceChart } from "../../components/PriceChart";
import { formatUsdc } from "../../format";
import { Governance } from "../site/Governance";
import { price, sinceLaunch } from "../site/Mutual";

export function Share({ account, version }: { account: string; version: number }) {
  const [m, setM] = useState<MutualSummary | null>(null);
  const [pos, setPos] = useState<PoolPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    getMutual().then(setM, (e: unknown) => setError(errorText(e)));
    getPosition(account).then(setPos, () => setPos(null));
  }, [account, version, tick]);

  if (error) return <LoadError message={error} />;
  if (!m) return <Loading />;
  const held = pos ? BigInt(pos.ward) + BigInt(pos.ward_locked) : 0n;
  const history = m.pool.price_history;
  const claims = [...m.claims].reverse().filter((c) => c.status === "paid");
  let claimIndex = 0;

  return (
    <div className="share" data-testid="my-share">
      <div className="share-top">
        <div className="value-card">
          <HorizonMark size={220} className="value-horizon" />
          <span className="vc-label">{SHARE.value}</span>
          <b className="vc-value num">{pos ? formatUsdc(pos.value) : "0.00"} USDC</b>
          <dl className="vc-facts">
            <div>
              <dt>{SHARE.held}</dt>
              <dd className="num">{formatUsdc(held.toString())} WARD</dd>
            </div>
            <div>
              <dt>{SHARE.price}</dt>
              <dd className="num">
                {price(m.pool.ward_price)} <small>{sinceLaunch(m.pool)}</small>
              </dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd className="acct">{account}</dd>
            </div>
          </dl>
          {held === 0n && <p className="vc-note">{SHARE.none}</p>}
        </div>
        <div className="panel chart-panel">
          <div className="ph">
            <h2>{SHARE.chart}</h2>
          </div>
          <div className="pb">
            <PriceChart history={history} launch={m.pool.launch_price} />
            <p className="fine">{SHARE.chartNote}</p>
          </div>
        </div>
      </div>

      <div className="share-bottom">
        <div className="panel">
          <div className="ph">
            <h2>{SHARE.sources}</h2>
          </div>
          <p className="panel-lede">{SHARE.sourcesLede}</p>
          <ol className="sources">
            {history.map((h, i) => {
              const claim = h.event === "claim" ? claims[claimIndex++] : undefined;
              const below = h.event === "claim" && claim && claim.paid_from_senior !== "0";
              return (
                <li key={`${h.at}-${i}`} data-event={h.event} className={below ? "below" : ""}>
                  <span>
                    {SHARE.events[h.event]}
                    {claim && (
                      <small>
                        {SHARE.coveredByUs(formatUsdc(claim.paid_from_junior))}
                        {claim.paid_from_senior !== "0" && `. ${SHARE.coveredByWard(formatUsdc(claim.paid_from_senior))}`}
                      </small>
                    )}
                  </span>
                  <span className="num">{price(h.price)}</span>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="panel pb vote-panel">
          <Governance proposals={m.governance.proposals} onChange={() => setTick((t) => t + 1)} embedded />
        </div>
      </div>
    </div>
  );
}
