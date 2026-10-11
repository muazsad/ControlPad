import type { AdminDailySummary } from "./admin-digest";

export type DashboardTone = "success" | "warning" | "danger" | "neutral";

/** Higher = more urgent. Used to order dashboard lists (danger first). */
const TONE_RANK: Record<DashboardTone, number> = {
  danger: 3,
  warning: 2,
  neutral: 1,
  success: 0,
};

export function toneRank(tone: DashboardTone): number {
  return TONE_RANK[tone];
}

/** Sort comparator: most severe tone first, then larger `size` (gap / count) first. */
export function bySeverity<T extends { tone: DashboardTone }>(
  size: (item: T) => number,
) {
  return (a: T, b: T) => toneRank(b.tone) - toneRank(a.tone) || size(b) - size(a);
}

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
  const paceItems = [...summary.behindPace, ...summary.missingWork];
  const dangerCount =
    summary.absences.length +
    summary.lowGrades.length +
    summary.quranSlippage.length +
    summary.overduePayments.length +
    summary.revisionOverdue.length +
    paceItems.filter((issue) => issue.tone === "danger").length;
  const warningCount =
    summary.tardies.length +
    summary.unmarked.length +
    summary.droppingGrades.length +
    summary.sabaqWithoutRevision.length +
    paceItems.filter((issue) => issue.tone !== "danger").length;

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
