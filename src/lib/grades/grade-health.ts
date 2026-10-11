import type { PaceContext } from "@/lib/grades/pace";
import { expectedDayPredicate } from "@/lib/grades/pace";
import {
  courseStaleness,
  staleDescription,
  type CourseStaleness,
} from "@/lib/grades/staleness";
import {
  gradeTrend,
  studentTrend,
  type GradeTrend,
  type StudentTrend,
} from "@/lib/grades/trend";

// Per-student rollup of staleness and trend, so every page asks the same
// question the same way. Pure: takes data already loaded in bulk.

export type CourseHealthInput = {
  courseId: string;
  courseName: string;
  createdAt: string | null;
  latestRecordedAt: string | null;
  snapshots: { recordedAt: string; grade: number }[];
};

export type CourseHealth = {
  courseId: string;
  courseName: string;
  staleness: CourseStaleness;
  trend: GradeTrend | null;
};

export type StudentGradeHealth = {
  courses: CourseHealth[];
  /** Courses that are stale or never graded, most overdue first. */
  staleCourses: CourseHealth[];
  /** True when the student has courses and every one is stale or never graded. */
  allStale: boolean;
  trend: StudentTrend;
  /** Tooltip text for the "Stale" badge ("Biology: no update in 12 school days; …"). */
  staleTitle: string;
};

export function studentGradeHealth(input: {
  courses: CourseHealthInput[];
  groupId: string | null;
  context: PaceContext;
  today: string;
}): StudentGradeHealth {
  const group = input.groupId ? (input.context.groups.get(input.groupId) ?? null) : null;
  const isExpectedDay = expectedDayPredicate(
    group,
    input.context.calendar,
    input.context.defaults,
  );

  const courses = input.courses.map((course): CourseHealth => ({
    courseId: course.courseId,
    courseName: course.courseName,
    staleness: courseStaleness({
      latestRecordedAt: course.latestRecordedAt,
      createdAt: course.createdAt,
      today: input.today,
      thresholdSchoolDays: input.context.staleGradeSchoolDays,
      isExpectedDay,
    }),
    trend: gradeTrend(course.snapshots, input.today),
  }));

  const staleCourses = courses
    .filter((course) => course.staleness.status !== "fresh")
    .sort(
      (a, b) =>
        (b.staleness.schoolDaysSince ?? 0) - (a.staleness.schoolDaysSince ?? 0),
    );

  return {
    courses,
    staleCourses,
    allStale: courses.length > 0 && staleCourses.length === courses.length,
    trend: studentTrend(
      courses.map((course) => ({ courseName: course.courseName, trend: course.trend })),
    ),
    staleTitle: staleCourses
      .map((course) => staleDescription(course.courseName, course.staleness))
      .join("; "),
  };
}
