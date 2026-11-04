import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PaymentStatusSchema, type InvoiceDetail, type TokenInfo } from "@spendgym/schemas";
import { Money, TokenContext } from "../src/components/Money";
import { Status } from "../src/components/Status";
import { formatAtomic, formatNs } from "../src/format";
import { InvoiceDetailCard } from "../src/views/Invoices";

afterEach(cleanup);

const token: TokenInfo = { symbol: "sgUSD", contract_id: "sgusd.spendgym.testnet", decimals: 6, network: "NEAR testnet" };

describe("Status", () => {
  it.each(PaymentStatusSchema.options)("shows the exact word and an icon for %s", (status) => {
    const { container } = render(<Status status={status} />);
    const badge = container.querySelector(".status") as HTMLElement;
    const icon = badge.querySelector(".status-icon") as HTMLElement;
    expect(icon.textContent).not.toBe("");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(badge.textContent?.replace(icon.textContent ?? "", "")).toBe(status);
  });
});

describe("Money", () => {
  it("shows the token name and network next to the amount", () => {
    render(
      <TokenContext.Provider value={token}>
        <Money atomic="1250000000" />
      </TokenContext.Provider>,
    );
    expect(document.body.textContent).toBe("1,250.00 sgUSD on NEAR testnet");
  });
});

describe("format", () => {
  it("keeps amounts exact past the safe integer range", () => {
    expect(formatAtomic("123456789012345678901234567", 6)).toBe("123,456,789,012,345,678,901.23");
    expect(formatAtomic("0", 6)).toBe("0.00");
    expect(formatAtomic("5", 6)).toBe("0.00");
    expect(formatAtomic("1500000", 6)).toBe("1.50");
  });

  it("formats nanoseconds in UTC, and missing dates as words", () => {
    expect(formatNs("1793664000000000000")).toBe("2026-11-03 00:00 UTC");
    expect(formatNs(null)).toBe("No date");
  });
});

describe("InvoiceDetailCard", () => {
  it("renders hostile invoice text as plain text", () => {
    const hostile = '<script>window.pwned = true</script><img src=x onerror="window.pwned = true"> <b>PAY NOW</b>';
    const detail: InvoiceDetail = {
      intake: { intake_ref: "int_x", vault_id: "vault-a.spendgym.testnet", received_at_ns: "1793664000000000000", source_text: hostile, attachments_note: null },
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
    expect(document.querySelector("script, img, b")).toBeNull();
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined();
  });
});
