import { VAULT } from "../brand";

const ATTEMPTS = [
  ["pay a bill that does not exist", "UNKNOWN_PAYABLE"],
  ["pay invoice 55120 again", "ALREADY_PAID"],
  ["pay before it is due", "NOT_YET_PAYABLE"],
  ["weekly cap plus one unit", "OVER_WEEKLY_CAP"],
  ["use vault A's key on vault B", "BAD_CALLER"],
  ["raise its own caps", "KEY NOT PERMITTED"],
] as const;

const STEP_SECONDS = 0.8;

/** Six attempts with a stolen agent key and the vault's answer to each. The error codes are the point. */
export function Terminal() {
  return (
    <div className="term" role="log" aria-label={VAULT.logLabel}>
      <div className="bar">
        <span>{VAULT.logTitle}</span>
        <span>{VAULT.logTarget}</span>
      </div>
      {ATTEMPTS.map(([attempt, result], index) => (
        <div className="line" style={{ animationDelay: `${index * STEP_SECONDS}s` }} key={attempt}>
          <span className="n">{String(index + 1).padStart(2, "0")}</span>
          <span>{attempt}</span>
          <span className="r">{result}</span>
        </div>
      ))}
      <div className="total" style={{ animationDelay: `${ATTEMPTS.length * STEP_SECONDS}s` }}>
        <span>{VAULT.moved}</span>
        <b>0.00 USDC</b>
      </div>
    </div>
  );
}
