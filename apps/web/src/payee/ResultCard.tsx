import { useState } from "react";
import type { EvidenceTier, PayeeVerdict } from "@wardline/schemas";
import type { PayeeRequest, PayeeResult } from "@wardline/sdk";
import { errorText, verifyInBrowser } from "../api/public";
import { RESULT, TIERS } from "../brand";
import { reasonWords, TIER_CODES, verdictClass } from "./reasons";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.5 } as const;

/** Icon plus word, never color alone. */
export function VerdictMark({ verdict, size = 18 }: { verdict: PayeeVerdict; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {verdict === "PAY" && (
        <>
          <circle cx="8" cy="8" r="6.5" {...stroke} />
          <path d="M5 8.2 7.2 10.3 11 6" {...stroke} />
        </>
      )}
      {verdict === "HOLD" && (
        <>
          <path d="M8 1.5 15 14.5H1Z" {...stroke} />
          <path d="M8 6v4" {...stroke} />
        </>
      )}
      {verdict === "BLOCK" && (
        <>
          <circle cx="8" cy="8" r="6.5" {...stroke} />
          <path d="M3.4 12.6 12.6 3.4" {...stroke} />
        </>
      )}
    </svg>
  );
}

export function TierBadge({ tier }: { tier: EvidenceTier }) {
  return (
    <span className="tier" data-tier={tier} title={`${TIERS[tier].verified} Does not establish: ${TIERS[tier].notEstablished}`}>
      <b>{TIER_CODES[tier]}</b>
      {TIERS[tier].short}
    </span>
  );
}

export function TierFacts({ tier }: { tier: EvidenceTier }) {
  return (
    <dl className="tierfacts">
      <div>
        <dt>Verified</dt>
        <dd>{TIERS[tier].verified}</dd>
      </div>
      <div>
        <dt>Does not establish</dt>
        <dd>{TIERS[tier].notEstablished}</dd>
      </div>
    </dl>
  );
}

const short = (text: string, keep = 18): string => (text.length > keep * 2 + 3 ? `${text.slice(0, keep)}...${text.slice(-keep)}` : text);

type VerifyState = { state: "idle" } | { state: "busy" } | { state: "done"; valid: boolean; key: string } | { state: "error"; message: string };

export function ReceiptBlock({ result, request }: { result: PayeeResult; request: PayeeRequest }) {
  const [verify, setVerify] = useState<VerifyState>({ state: "idle" });
  const { receipt } = result;
  if (!receipt) return <p className="rc-note">{RESULT.noReceipt}</p>;
  const run = async () => {
    setVerify({ state: "busy" });
    try {
      setVerify({ state: "done", ...(await verifyInBrowser(result, request)) });
    } catch (error) {
      setVerify({ state: "error", message: errorText(error) });
    }
  };
  return (
    <div className="receipt">
      <div className="rc-head">
        <span>{RESULT.receipt}</span>
        <button type="button" className="sbtn ghost" onClick={() => void run()} disabled={verify.state === "busy"}>
          {verify.state === "busy" ? RESULT.verifying : RESULT.verify}
        </button>
      </div>
      <dl className="rc-fields">
        <div>
          <dt>id</dt>
          <dd>{receipt.id}</dd>
        </div>
        <div>
          <dt>issued</dt>
          <dd>{receipt.issuedAt}</dd>
        </div>
        <div>
          <dt>request</dt>
          <dd title={receipt.requestHash}>{short(receipt.requestHash)}</dd>
        </div>
        <div>
          <dt>signature</dt>
          <dd title={receipt.signature}>{short(receipt.signature)}</dd>
        </div>
      </dl>
      <p className="rc-status" role="status" aria-live="polite">
        {verify.state === "done" && (
          <span className={verify.valid ? "ok" : "bad"} data-verified={verify.valid ? "valid" : "invalid"}>
            {verify.valid ? RESULT.verified : RESULT.notVerified}
          </span>
        )}
        {verify.state === "error" && <span className="bad">{verify.message}</span>}
      </p>
    </div>
  );
}

/** The verdict, each reason in plain words, the trust level and the signed receipt. */
export function ResultCard({ result, request }: { result: PayeeResult; request: PayeeRequest }) {
  const account = "payee" in result ? result.payee : result.account;
  const tier = result.evidenceTier ?? "T0_NONE";
  return (
    <article className={`result ${verdictClass(result.verdict)}`} aria-label={`Verdict ${result.verdict}`} data-verdict={result.verdict}>
      <div className="r-top">
        <div>
          <div className="r-verdict">
            <VerdictMark verdict={result.verdict} size={30} />
            <span>{result.verdict}</span>
          </div>
          <p className="r-line">{RESULT.verdicts[result.verdict]}</p>
        </div>
        <TierBadge tier={tier} />
      </div>
      <dl className="r-facts">
        <div>
          <dt>{RESULT.account}</dt>
          <dd className="mono">{account ?? "None"}</dd>
        </div>
        {result.vendor && (
          <div>
            <dt>Vendor</dt>
            <dd>
              {result.vendor.name} <span className="mono">{result.vendor.domain}</span>
            </dd>
          </div>
        )}
      </dl>
      <h3 className="r-h">{RESULT.reasons}</h3>
      <ul className="r-reasons">
        {result.reasons.map((reason) => (
          <li key={`${reason.code}-${reason.detail}`}>
            <span>{reasonWords(reason.code)}</span>
            <code>{reason.code}</code>
            <small>{reason.detail}</small>
          </li>
        ))}
      </ul>
      <TierFacts tier={tier} />
      <ReceiptBlock result={result} request={request} />
    </article>
  );
}
