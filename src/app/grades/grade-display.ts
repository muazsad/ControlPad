export type GradeTone = "neutral" | "danger" | "warning" | "success";

export function latestGrade<T extends { recorded_at: string }>(
  grades: T[],
): T | null {
  if (grades.length === 0) return null;

  return grades.reduce((latest, grade) =>
    new Date(grade.recorded_at).getTime() >
    new Date(latest.recorded_at).getTime()
      ? grade
      : latest,
  );
}

export function gradeTone(
  value: number | null,
  gradeFloor: number | null,
): GradeTone {
  if (value === null) return "neutral";
  if (gradeFloor === null) return "neutral";
  if (value < gradeFloor) return "danger";
  if (value < gradeFloor + 5) return "warning";
  return "success";
}

export function formatGrade(value: number | null) {
  if (value === null) return "No data";
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}
