import type { ReactNode } from "react";
import type { PaymentStatus } from "@wardline/schemas";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.5 } as const;
const ring = <circle cx="8" cy="8" r="6.5" {...stroke} />;

const STYLES: Record<PaymentStatus, { className: string; icon: ReactNode }> = {
  requested: {
    className: "requested",
    icon: (
      <>
        {ring}
        <path d="M5 8h5.5M8.3 5.6 10.7 8l-2.4 2.4" {...stroke} />
      </>
    ),
  },
  reserved: {
    className: "reserved",
    icon: (
      <>
        {ring}
        <path d="M8 4.5V8l2.5 1.5" {...stroke} />
      </>
    ),
  },
  settled: {
    className: "settled",
    icon: (
      <>
        {ring}
        <path d="M5 8.2 7.2 10.3 11 6" {...stroke} />
      </>
    ),
  },
  "rejected by policy": {
    className: "policy",
    icon: (
      <>
        <rect x="1.5" y="1.5" width="13" height="13" rx="2" {...stroke} />
        <path d="M5 8h6" {...stroke} />
      </>
    ),
  },
  "review needed": {
    className: "review",
    icon: (
      <>
        <path d="M8 1.5 15 14.5H1Z" {...stroke} />
        <path d="M8 6v4" {...stroke} />
      </>
    ),
  },
  flagged: { className: "flagged", icon: <path d="M3 15V1.5h10L10.5 5 13 8.5H3" {...stroke} /> },
  "outcome uncertain": {
    className: "uncertain",
    icon: (
      <>
        {ring}
        <path d="M6.2 6.2a1.9 1.9 0 1 1 2.8 1.7c-.7.4-1 .8-1 1.5" {...stroke} />
        <circle cx="8" cy="11.6" r=".9" fill="currentColor" />
      </>
    ),
  },
};

/** Always icon plus word, never color alone. The word is the exact status term. */
export function Status({ status, suffix }: { status: PaymentStatus; suffix?: string }) {
  const { className, icon } = STYLES[status];
  return (
    <span className={`st ${className}`} data-status={status}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        {icon}
      </svg>
      {status}
      {suffix}
    </span>
  );
}
