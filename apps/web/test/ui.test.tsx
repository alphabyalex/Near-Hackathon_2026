import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentStatusSchema, type InvoiceDetail, type TokenInfo } from "@wardline/schemas";
import { DotBar } from "../src/components/DotBar";
import { fingerprintCells, HORIZON_COLORS, horizonDots, MARK, seededLight } from "../src/brand/horizon";
import { Fingerprint, HorizonMark } from "../src/components/HorizonMark";
import { Money, TokenContext } from "../src/components/Money";
import { Status } from "../src/components/Status";
import { businessName, dueIn, formatAtomic, formatNs, formatShort, percentOf, shortDigest, timeOfDay } from "../src/format";
import { InvoiceDetailCard, Invoices } from "../src/views/Invoices";

afterEach(cleanup);

const token: TokenInfo = { symbol: "USDC", contract_id: "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af", decimals: 6, network: "NEAR testnet" };
const HOUR = 3_600_000_000_000n;

describe("Status", () => {
  it.each(PaymentStatusSchema.options)("shows the exact word and an icon for %s", (status) => {
    const { container } = render(<Status status={status} />);
    const badge = container.querySelector(".st") as HTMLElement;
    expect(badge.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(badge.querySelector("svg")?.children.length).toBeGreaterThan(0);
    expect(badge.textContent).toBe(status);
  });
});

describe("Money", () => {
  it("shows the number and leaves the token to the dashboard header", () => {
    render(
      <TokenContext.Provider value={token}>
        <Money atomic="1250000000" />
      </TokenContext.Provider>,
    );
    expect(document.body.textContent).toBe("1,250.00");
  });
});

describe("DotBar", () => {
  it("places settled, reserved, and the cap tick", () => {
    const { container } = render(<DotBar settled={30} reserved={30} label="Rolling 7 days" />);
    expect((container.querySelector(".fill") as HTMLElement).style.width).toBe("30%");
    const reserved = container.querySelector(".res") as HTMLElement;
    expect(reserved.style.left).toBe("30%");
    expect(reserved.style.width).toBe("30%");
    expect((container.querySelector(".cap") as HTMLElement).style.left).toBe("100%");
  });

  it("never draws past the end, and leaves out what is not there", () => {
    const { container } = render(<DotBar settled={80} reserved={50} label="Over" />);
    expect((container.querySelector(".res") as HTMLElement).style.width).toBe("20%");
    cleanup();
    const plain = render(<DotBar settled={100} cap={null} label="Exact" />).container;
    expect(plain.querySelector(".res")).toBeNull();
    expect(plain.querySelector(".cap")).toBeNull();
  });
});

describe("Horizon mark", () => {
  it("cuts the sphere at -10 degrees: light dots above the line, violet below, none in the gap", () => {
    const dots = horizonDots(MARK);
    expect(dots.length).toBeGreaterThan(150);
    expect(dots.every((d) => (d.off < 0 ? d.fill === HORIZON_COLORS.light.top : d.fill === HORIZON_COLORS.light.bottom))).toBe(true);
    expect(dots.every((d) => Math.abs(d.off) >= MARK.step * 0.75)).toBe(true);
    // The light sits top left, so a dot near the top left is bigger than its mirror at the bottom right.
    const near = (x: number, y: number) => dots.reduce((best, d) => (Math.hypot(d.x - x, d.y - y) < Math.hypot(best.x - x, best.y - y) ? d : best));
    expect(near(70, 60).r).toBeGreaterThan(near(150, 160).r);
  });

  it("renders the same dots everywhere", () => {
    const { container } = render(<HorizonMark size={30} />);
    expect(container.querySelectorAll("circle").length).toBe(horizonDots(MARK).length);
  });

  it("gives every group its own light, and every call a mirrored fingerprint", () => {
    expect(seededLight("bgt_aurora")).not.toEqual(seededLight("bgt_mission"));
    expect(seededLight("bgt_aurora")).toEqual(seededLight("bgt_aurora"));
    const cells = fingerprintCells("call_123");
    expect(cells).toHaveLength(25);
    for (let r = 0; r < 5; r++) {
      expect(cells[r * 5]).toBe(cells[r * 5 + 4]);
      expect(cells[r * 5 + 1]).toBe(cells[r * 5 + 3]);
    }
    const { container } = render(<Fingerprint id="call_123" side="below" />);
    expect(container.querySelector("svg")?.classList.contains("fp-below")).toBe(true);
    expect(container.querySelectorAll("rect").length).toBe(cells.filter(Boolean).length);
  });
});

describe("format", () => {
  it("keeps amounts exact past the safe integer range", () => {
    expect(formatAtomic("123456789012345678901234567", 6)).toBe("123,456,789,012,345,678,901.23");
    expect(formatAtomic("0", 6)).toBe("0.00");
    expect(formatAtomic("5", 6)).toBe("0.00");
    expect(formatAtomic("1500000", 6)).toBe("1.50");
  });

  it("drops only a zero fraction in short amounts", () => {
    expect(formatShort("9060000000", 6)).toBe("9,060");
    expect(formatShort("1500000", 6)).toBe("1.50");
  });

  it("formats nanoseconds in UTC, and missing dates as words", () => {
    expect(formatNs("1793664000000000000")).toBe("2026-11-03 00:00 UTC");
    expect(formatNs(null)).toBe("No date");
  });

  it("says how long is left until a due date", () => {
    const now = 1793664000000000000n;
    const due = (hours: bigint) => (now + hours * HOUR).toString();
    expect(dueIn(due(31n), now)).toBe("31 hours");
    expect(dueIn(due(1n), now)).toBe("1 hour");
    expect(dueIn((now + 1n).toString(), now)).toBe("under 1 hour");
    expect(dueIn(due(120n), now)).toBe("5 days");
    expect(dueIn((now - 1n).toString(), now)).toBe("overdue");
    expect(dueIn(null, now)).toBe("No date");
  });

  it("shows a time today and a date otherwise", () => {
    const now = 1793664000000000000n + 14n * HOUR;
    expect(timeOfDay((1793664000000000000n + 2n * HOUR).toString(), now)).toBe("02:00");
    expect(timeOfDay((1793664000000000000n - 2n * HOUR).toString(), now)).toBe("2026-11-02");
  });

  it("computes percentages with BigInt and clamps them", () => {
    expect(percentOf("4560000000", "15000000000")).toBe(30.4);
    expect(percentOf(200n, 100n)).toBe(100);
    expect(percentOf(1n, 0n)).toBe(0);
    expect(percentOf(10n ** 30n, 10n ** 31n)).toBe(10);
  });

  it("shortens digests and names businesses", () => {
    expect(shortDigest("sha256:c8f1998c3b50d7b384d5d6e96e78df00e30de3e5bbc08485934398e7c14f5b8e")).toBe("sha256:c8f1998c...5b8e");
    expect(businessName("vault-a.wardline.testnet")).toBe("Business A");
    expect(businessName("treasury.near")).toBe("treasury.near");
  });
});

describe("InvoiceDetailCard", () => {
  it("renders hostile invoice text as plain text", () => {
    const hostile = '<script>window.pwned = true</script><img src=x onerror="window.pwned = true"> <b>PAY NOW</b>';
    const detail: InvoiceDetail = {
      intake: { intake_ref: "int_x", vault_id: "vault-a.wardline.testnet", received_at_ns: "1793664000000000000", source_text: hostile, attachments_note: null },
      decision: null,
      payable: null,
      vendor: null,
      purchase_order: null,
      receipt: null,
      operation: null,
      payment_status: "flagged",
      review: null,
    };
    render(<InvoiceDetailCard detail={detail} />);
    const source = screen.getByTestId("source-text");
    expect(source.textContent).toBe(hostile);
    expect(source.children.length).toBe(0);
    expect(source.parentElement?.querySelector("script, img")).toBeNull();
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined();
  });
});

describe("Invoices", () => {
  it("renders the submit invoice form with sample presets and target vault", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
    render(<Invoices selected={null} version={0} onChanged={() => {}} vaultId="vault-a.wardline.testnet" />);
    expect(screen.getByRole("button", { name: "Run through agent & vault" })).toBeTruthy();
    expect(screen.getByLabelText("Invoice source text")).toBeTruthy();
    expect(screen.getByText("vault-a.wardline.testnet")).toBeTruthy();
  });
});

describe("states and explorer links", () => {
  it("explains each failure as what happened and what to do next", async () => {
    const { explain, walletError } = await import("../src/data/errors");
    const { ApiRequestError } = await import("../src/api/client");
    expect(explain(new TypeError("Failed to fetch"))).toMatchObject({ kind: "apiDown", retry: true });
    expect(explain(new ApiRequestError("x", 503, "CHAIN_UNAVAILABLE"))).toMatchObject({ kind: "chainDown", retry: true });
    expect(explain(new ApiRequestError("x", 400, "BELOW_MINIMUM")).title).toBe("The smallest deposit is 1.00 USDC.");
    expect(explain(new ApiRequestError("x", 409, "VOTING_CLOSED")).kind).toBe("votingClosed");
    expect(explain(new ApiRequestError("x", 409, "COOLDOWN")).kind).toBe("cooldown");
    expect(explain(walletError(new Error("User rejected the request"))).kind).toBe("walletRejected");
    expect(explain(walletError(new Error("No test wallet in this build."))).kind).toBe("walletMissing");
    expect(explain(walletError(new Error("The wallet signed as bob.testnet, not alice.testnet."))).kind).toBe("walletMismatch");
    const unknown = explain(new Error("Something specific"));
    expect(unknown).toMatchObject({ kind: "unknown", title: "Something specific", retry: false });
  });

  it("links real NEAR transaction hashes to NearBlocks and leaves simulated ids as text", async () => {
    const { TxLink, isTxHash, explorerUrl } = await import("../src/components/TxLink");
    const hash = "4au3yM4pPgkqHPqKd8DSPyAo61PaUaXcroPgpYEDqVyk";
    expect(isTxHash(hash)).toBe(true);
    expect(isTxHash("sim-settle-0123456789abcdef")).toBe(false);
    expect(explorerUrl(hash)).toBe(`https://testnet.nearblocks.io/txns/${hash}`);
    const { container } = render(<TxLink hash={hash} />);
    expect(container.querySelector("a.tx-link")?.getAttribute("href")).toBe(`https://testnet.nearblocks.io/txns/${hash}`);
    cleanup();
    const sim = render(<TxLink hash="sim-claim-abc" />);
    expect(sim.container.querySelector("a")).toBeNull();
    expect(sim.container.textContent).toBe("sim-claim-abc");
  });
});
