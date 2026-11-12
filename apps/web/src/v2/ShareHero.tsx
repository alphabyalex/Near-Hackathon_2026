/**
 * Pieces of Your share (docs/design/v2/Share.dc.html) used by the Balance page: the personal sphere seeded
 * from the connected account's name (the same name always draws the same mark) with its value counting up
 * once, and Request to sell.
 */
import { useCallback, useRef, useState } from "react";
import { MINE, MEMBER } from "../brand";
import { Problem } from "../components/Problem";
import { TxLink } from "../components/TxLink";
import { signMutual } from "../data/mutual";
import { addPending } from "../data/transactions";
import { formatUsdc } from "../format";
import { toAtomic } from "../api/ai";
import type { Connected } from "../wallets/connected";
import { boxOf, frozenFrame, useCanvasAnimation } from "./motion";
import { easeOut, fitCanvas, paintDots, PERSONAL_SPHERE, personalSphere, sphereDots } from "./sphere";

/** The mark assembles over 1.8s; the value counts up from 0.3s for 1.4s. Sizes live in PERSONAL_SPHERE. */
export const SHARE_MOTION = {
  end: 2.4,
  assemble: 1.8,
  countFrom: 0.3,
  countFor: 1.4,
  /** The reference draws a 440px mark; dot spacing scales with the mark so it looks the same at 260px. */
  design: 440,
} as const;

const count = (atomic: string, u: number): string => ((Number(atomic) / 1e6) * u).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PersonalMark({ account, value, valueRef }: { account: string; value: string; valueRef?: React.RefObject<HTMLSpanElement | null> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const seed = personalSphere(account);
  const draw = useCallback(
    (t: number) => {
      const out = valueRef?.current;
      if (out) {
        const u = easeOut((t - SHARE_MOTION.countFrom) / SHARE_MOTION.countFor);
        out.textContent = u >= 1 ? formatUsdc(value) : count(value, u);
      }
      const cv = ref.current;
      if (!cv) return;
      const S = boxOf(cv).w;
      if (!S) return;
      const ctx = fitCanvas(cv, S, S);
      if (!ctx) return;
      const k = S / SHARE_MOTION.design;
      const R = S * PERSONAL_SPHERE.radius;
      const dots = sphereDots({ cx: S / 2, cy: S / 2, R, step: seed.step * k, light: seed.light, floor: PERSONAL_SPHERE.floor, gap: S * PERSONAL_SPHERE.gap });
      paintDots(ctx, dots, R, easeOut(t / SHARE_MOTION.assemble));
    },
    [account, value, seed.step, seed.light[0], seed.light[1]],
  );
  useCanvasAnimation(ref, draw, { duration: SHARE_MOTION.end, freezeAt: frozenFrame("share") });
  return <canvas ref={ref} className="mine-mark" role="img" aria-label={MINE.markLabel} data-testid="personal-mark" data-step={seed.step} />;
}

/** Request to sell: WARD to lock for the 7-day wait, signed by the connected wallet. */
export function SellForm({ connected, onDone, onClose }: { connected: Connected; onDone: () => void; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<{ text: string; tx: string | null } | null>(null);
  const send = async () => {
    const atomic = toAtomic(amount);
    if (!atomic) return;
    setBusy(true);
    setError(null);
    try {
      const res = await signMutual(connected.wallet, { account: connected.account, action: "withdraw", amount: atomic });
      if (res.tx) addPending(connected.account, { hash: res.tx, type: "sell_request", ward: atomic, unlock_at: res.available_at ?? null });
      setDone({ text: MEMBER.locked7(res.available_at?.slice(0, 10) ?? ""), tx: res.tx ?? null });
      setAmount("");
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mine-sell" data-testid="sell-form">
      <label className="field">
        <span>{MINE.sellAmount}</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="num" autoFocus />
      </label>
      <div className="mine-sell-actions">
        <button type="button" className="btn ghost" disabled={busy || !toAtomic(amount)} onClick={() => void send()}>
          {MINE.sellButton}
        </button>
        <button type="button" className="btn ghost sm link-btn" onClick={onClose}>
          {MINE.sellCancel}
        </button>
      </div>
      {error !== null && <Problem error={error} compact />}
      {done && (
        <p className="ok-line" role="status">
          {done.text} {done.tx && <TxLink hash={done.tx} />}
        </p>
      )}
    </div>
  );
}
