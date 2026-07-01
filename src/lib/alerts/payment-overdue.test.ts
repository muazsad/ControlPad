import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeOverduePaymentCycles,
  periodMonthFor,
} from "./payment-overdue";

describe("payment overdue helper", () => {
  it("does not count cycles whose due date is before enrollment", () => {
    const overdue = computeOverduePaymentCycles({
      asOfDate: "2026-07-31",
      paymentDueDay: 5,
      enrollmentAnchorDate: "2026-07-01",
      cycles: [
        { periodMonth: "2026-06-01", status: "unpaid" },
        { periodMonth: "2026-07-01", status: "paid" },
      ],
    });

    assert.equal(overdue.length, 0);
  });

  it("never counts a paid cycle as overdue", () => {
    const overdue = computeOverduePaymentCycles({
      asOfDate: "2026-07-31",
      paymentDueDay: 5,
      enrollmentAnchorDate: "2026-06-01",
      cycles: [{ periodMonth: "2026-07-01", status: "paid" }],
    });

    assert.equal(overdue.length, 0);
  });

  it("counts unpaid cycles after enrollment once the due day has passed", () => {
    const overdue = computeOverduePaymentCycles({
      asOfDate: "2026-07-31",
      paymentDueDay: 5,
      enrollmentAnchorDate: "2026-06-01",
      cycles: [{ periodMonth: "2026-07-01", status: "unpaid" }],
    });

    assert.equal(overdue.length, 1);
    assert.equal(overdue[0].periodMonth, "2026-07-01");
    assert.equal(overdue[0].daysOverdue, 26);
  });

  it("does not count the current cycle before the payment due day has passed", () => {
    const overdue = computeOverduePaymentCycles({
      asOfDate: "2026-07-05",
      paymentDueDay: 5,
      enrollmentAnchorDate: "2026-07-01",
      cycles: [{ periodMonth: "2026-07-01", status: "unpaid" }],
    });

    assert.equal(overdue.length, 0);
  });

  it("uses the current cycle as the anchor when no enrollment date is known", () => {
    const overdue = computeOverduePaymentCycles({
      asOfDate: "2026-07-31",
      paymentDueDay: 5,
      enrollmentAnchorDate: null,
      cycles: [
        { periodMonth: "2026-06-01", status: "unpaid" },
        { periodMonth: "2026-07-01", status: "unpaid" },
      ],
    });

    assert.deepEqual(
      overdue.map((cycle) => cycle.periodMonth),
      ["2026-07-01"],
    );
  });

  it("returns the first day of the month for a date", () => {
    assert.equal(periodMonthFor("2026-07-31"), "2026-07-01");
  });
});
