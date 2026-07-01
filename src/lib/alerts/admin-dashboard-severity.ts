import type { AdminDailySummary } from "./admin-digest";

export type DashboardTone = "success" | "warning" | "danger" | "neutral";

export type GradeIssueCounts = {
  belowFloorCount: number;
  droppingCount: number;
};

export type DailySummarySeverity = {
  tone: DashboardTone;
  label: string;
  dangerCount: number;
  warningCount: number;
};

export function gradeIssueSeverity({
  belowFloorCount,
  droppingCount,
}: GradeIssueCounts): DashboardTone {
  if (belowFloorCount > 0) return "danger";
  if (droppingCount > 0) return "warning";
  return "success";
}

export function dailySummarySeverity(
  summary: AdminDailySummary,
): DailySummarySeverity {
  const dangerCount =
    summary.absences.length +
    summary.lowGrades.length +
    summary.quranSlippage.length +
    summary.overduePayments.length;
  const warningCount = summary.tardies.length + summary.droppingGrades.length;

  if (dangerCount > 0) {
    return {
      tone: "danger",
      label: "Needs attention",
      dangerCount,
      warningCount,
    };
  }

  if (warningCount > 0) {
    return {
      tone: "warning",
      label: `All clear, ${warningCount} to watch`,
      dangerCount,
      warningCount,
    };
  }

  return {
    tone: "success",
    label: "All clear",
    dangerCount,
    warningCount,
  };
}
