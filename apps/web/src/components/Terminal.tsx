const ATTEMPTS = [
  ["pay a bill that does not exist", "UNKNOWN_PAYABLE"],
  ["pay invoice 55120 again", "ALREADY_PAID"],
  ["pay before it is due", "NOT_YET_PAYABLE"],
  ["weekly cap plus one unit", "OVER_WEEKLY_CAP"],
  ["use vault A's key on vault B", "BAD_CALLER"],
  ["raise its own caps", "KEY NOT PERMITTED"],
] as const;

const STEP_SECONDS = 0.8;

/** The attack log replay. The sequence loops in CSS and rests fully visible under reduced motion. */
export function Terminal() {
  return (
    <div className="term" role="log" aria-label="Attack script output">
      <div className="bar">
        <span>
          malicious-signer.ts<span className="caret" />
        </span>
        <span>vault-a.redline.testnet</span>
      </div>
      {ATTEMPTS.map(([attempt, result], index) => (
        <div className="line" style={{ animationDelay: `${index * STEP_SECONDS}s` }} key={attempt}>
          <span className="n">{String(index + 1).padStart(2, "0")}</span>
          <span>{attempt}</span>
          <span className="r">{result}</span>
        </div>
      ))}
      <div className="total" style={{ animationDelay: `${ATTEMPTS.length * STEP_SECONDS}s` }}>
        <span>moved from the vault</span>
        <b>0.00 sgUSD</b>
      </div>
    </div>
  );
}
