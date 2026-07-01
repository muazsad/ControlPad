export type PaymentCycleStatus = "paid" | "unpaid" | "overdue";

export type PaymentCycle = {
  periodMonth: string;
  status: PaymentCycleStatus;
};

export type OverduePaymentCycle = {
  periodMonth: string;
  dueDate: string;
  daysOverdue: number;
};

export type OverduePaymentInput = {
  asOfDate: string;
  paymentDueDay: number;
  enrollmentAnchorDate: string | null;
  cycles: PaymentCycle[];
};

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function dateMs(date: string): number {
  return new Date(`${dateOnly(date)}T00:00:00.000Z`).getTime();
}

function daysBetween(startDate: string, endDate: string): number {
  return Math.floor((dateMs(endDate) - dateMs(startDate)) / (1000 * 60 * 60 * 24));
}

export function periodMonthFor(date: string): string {
  return `${dateOnly(date).slice(0, 7)}-01`;
}

export function paymentDueDate(periodMonth: string, paymentDueDay: number): string {
  const d = new Date(`${periodMonthFor(periodMonth)}T00:00:00.000Z`);
  d.setUTCDate(paymentDueDay);
  return d.toISOString().slice(0, 10);
}

export function computeOverduePaymentCycles({
  asOfDate,
  paymentDueDay,
  enrollmentAnchorDate,
  cycles,
}: OverduePaymentInput): OverduePaymentCycle[] {
  const anchor = enrollmentAnchorDate
    ? dateOnly(enrollmentAnchorDate)
    : periodMonthFor(asOfDate);
  const asOf = dateOnly(asOfDate);

  return cycles
    .map((cycle) => ({
      ...cycle,
      periodMonth: periodMonthFor(cycle.periodMonth),
      dueDate: paymentDueDate(cycle.periodMonth, paymentDueDay),
    }))
    .filter((cycle) => cycle.status !== "paid")
    .filter((cycle) => cycle.dueDate >= anchor)
    .filter((cycle) => cycle.dueDate < asOf)
    .map((cycle) => ({
      periodMonth: cycle.periodMonth,
      dueDate: cycle.dueDate,
      daysOverdue: daysBetween(cycle.dueDate, asOf),
    }));
}
