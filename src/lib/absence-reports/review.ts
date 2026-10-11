// Pure rules for an admin's decision on a parent-reported absence.

export type ReviewDecision = "excused" | "unexcused" | "dismissed";
export type ReviewAttendanceStatus = "present" | "tardy" | "absent" | "excused";

export const REVIEW_DECISIONS: ReviewDecision[] = ["excused", "unexcused", "dismissed"];

export function parseReviewDecision(value: string): ReviewDecision | null {
  return (REVIEW_DECISIONS as string[]).includes(value) ? (value as ReviewDecision) : null;
}

/**
 * What the decision does to that day's attendance row.
 * - excused → "excused", unexcused → "absent", dismissed → leave it alone.
 * - A student already marked present or tardy came in, so excusing or marking
 *   them absent would overwrite real attendance: refuse, and suggest dismissing.
 */
export function attendanceForDecision(
  decision: ReviewDecision,
  existing: ReviewAttendanceStatus | null,
): { status: "excused" | "absent" | null } | { error: string } {
  if (decision === "dismissed") return { status: null };
  if (existing === "present" || existing === "tardy") {
    return {
      error: `The student is already marked ${existing} that day. Dismiss the report instead, or change attendance first.`,
    };
  }
  return { status: decision === "excused" ? "excused" : "absent" };
}

export function reportNote(reason: string | null): string {
  return reason ? `Parent reported: ${reason}` : "Parent reported absence";
}
