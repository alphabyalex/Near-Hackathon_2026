/** The Balance page in dollars: the earned math, the dollar figures and the quiet NEAR line. */
import { describe, expect, it } from "vitest";
import { dollars, earned, nearFees, signedDollars, wardDollars } from "../src/views/site/Balance";
import { confirmedTotals, type WalletTx } from "../src/data/transactions";

const tx = (over: Partial<WalletTx>): WalletTx =>
  ({ hash: `h${Math.random()}`, at: "2026-11-10T00:00:00.000Z", type: "buy", status: "confirmed", usdc: null, ward: null, price: null, proposal: null, support: null, unlock_at: null, signer: "a.testnet", explorer_url: "", source: "chain", ...over }) as WalletTx;

describe("earned since joining", () => {
  it("adds every deposit and the sell from the history: value + redeemed - deposited", () => {
    const rows = [tx({ type: "buy", usdc: "10000000" }), tx({ type: "buy", usdc: "10000000" }), tx({ type: "buy", usdc: "5000000" }), tx({ type: "sell", usdc: "6000000" }), tx({ type: "buy", usdc: "99000000", status: "failed" })];
    const { deposited, redeemed } = confirmedTotals(rows);
    expect(deposited).toBe("25000000");
    expect(redeemed).toBe("6000000");
    // 25 in, 6 out, 19.05 worth today: +0.05.
    expect(earned({ value: 19_050_000n, deposited: BigInt(deposited), redeemed: BigInt(redeemed), held: 19_000_000n, complete: true })).toBe(50_000n);
  });

  it("hyperios.testnet: two 10 USDC deposits, worth 20.000048 today, is about zero, not +10", () => {
    const gain = earned({ value: 20_000_048n, deposited: 20_000_000n, redeemed: 0n, held: 19_992_232n, complete: true });
    expect(gain).toBe(48n);
    expect(signedDollars(gain!)).toBe("+$0.00");
  });

  it("is hidden when the history is incomplete, when nothing is held, or when deposits are unknown", () => {
    expect(earned({ value: 20_000_048n, deposited: 10_000_000n, redeemed: 0n, held: 19_992_232n, complete: false })).toBeNull();
    expect(earned({ value: 0n, deposited: 10_000_000n, redeemed: 10_000_000n, held: 0n, complete: true })).toBeNull();
    expect(earned({ value: 1n, deposited: null, redeemed: 0n, held: 1n, complete: true })).toBeNull();
  });

  it("signs the amount: violet gains, red losses, under a cent reads +$0.00", () => {
    expect(signedDollars(10_000n)).toBe("+$0.01");
    expect(signedDollars(-50_000n)).toBe("-$0.05");
    expect(signedDollars(-9_999n)).toBe("+$0.00");
  });
});

describe("dollars", () => {
  it("1 USDC is $1, WARD is held times today's price, to the cent with separators", () => {
    expect(dollars(140_000_000n)).toBe("140.00");
    expect(dollars(1_234_567_890n)).toBe("1,234.57");
    // 19.992232 WARD at 1.000388 USDC.
    expect(wardDollars(19_992_232n, "1000388")).toBe(19_999_988n);
    expect(dollars(wardDollars(19_992_232n, "1000388"))).toBe("20.00");
  });

  it("the NEAR line stays in NEAR, is not counted, and warns only under 0.05", () => {
    expect(nearFees(394_000_000_000_000_000_000_000n)).toEqual({ text: "0.394 NEAR set aside for network fees, not counted in your balance", low: false });
    expect(nearFees(10_000_000_000_000_000_000_000n).low).toBe(true);
  });
});
