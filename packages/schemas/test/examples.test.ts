import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import * as s from "../src/index.js";

const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "examples");

const SCHEMAS: Record<string, ZodType> = {
  "vendor.json": s.VendorSchema,
  "purchase-order.json": s.PurchaseOrderSchema,
  "goods-receipt.json": s.GoodsReceiptSchema,
  "payable-status.json": s.PayableStatusSchema,
  "payable.json": s.PayableSchema,
  "policy.json": s.PolicySchema,
  "agent-binding.json": s.AgentBindingSchema,
  "intake.json": s.IntakeSchema,
  "agent-context.json": s.AgentContextSchema,
  "reason-code.json": s.ReasonCodeSchema,
  "decision.json": s.DecisionSchema,
  "payment-request.json": s.PaymentRequestSchema,
  "vault-rejection.json": s.VaultRejectionSchema,
  "request-result.json": s.RequestResultSchema,
  "operation.json": s.OperationSchema,
  "vault-usage.json": s.VaultUsageSchema,
  "review-item.json": s.ReviewItemSchema,
  "manifest.json": s.ManifestSchema,
  "scenario.json": s.ScenarioSchema,
  "evaluation-report.json": s.EvaluationReportSchema,
  "report-verification.json": s.ReportVerificationSchema,
  "redline-event.json": s.RedlineEventSchema,
};

const read = (file: string): unknown => JSON.parse(readFileSync(join(EXAMPLES_DIR, file), "utf8"));

describe("examples", () => {
  it("every example file has a schema, and every schema has a file", () => {
    expect(readdirSync(EXAMPLES_DIR).sort()).toEqual(Object.keys(SCHEMAS).sort());
  });

  it.each(Object.keys(SCHEMAS))("%s is valid", (file) => {
    const result = SCHEMAS[file]!.safeParse(read(file));
    expect(result.error?.issues ?? []).toEqual([]);
  });
});

describe("rules", () => {
  it("rejects amounts that are not integer strings", () => {
    for (const bad of ["1.5", "-1", "01", "", 5]) {
      expect(s.AtomicAmountSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("rejects a PAY decision with no matched payable", () => {
    const decision = { ...(read("decision.json") as object), matched_payable_ref: null };
    expect(s.DecisionSchema.safeParse(decision).success).toBe(false);
  });

  it("allows a REVIEW decision with no matched payable", () => {
    const decision = { ...(read("decision.json") as object), decision: "REVIEW", matched_payable_ref: null };
    expect(s.DecisionSchema.safeParse(decision).success).toBe(true);
  });

  it("rejects contradictory request results", () => {
    expect(s.RequestResultSchema.safeParse({ ok: true, operation_id: null, rejection: null }).success).toBe(false);
    expect(s.RequestResultSchema.safeParse({ ok: false, operation_id: "op", rejection: "PAUSED" }).success).toBe(false);
    expect(s.RequestResultSchema.safeParse({ ok: false, operation_id: null, rejection: "PAUSED" }).success).toBe(true);
  });

  it("rejects a metric whose numerator exceeds its denominator", () => {
    const metric = { metric_id: "m", label: "m", numerator: 2, denominator: 1 };
    expect(s.EvaluationMetricSchema.safeParse(metric).success).toBe(false);
  });
});
