// Staff accountability: for today, which responsible teacher still has
// attendance to mark or Quran lessons to log. Pure logic — DB loading is in
// staff-accountability-data.ts.
// Spec: docs/superpowers/specs/2026-10-11-staff-accountability-design.md
//
// Rules:
// - A student's teacher is their schedule group's teacher. Ungrouped students
//   and groups without a teacher land in a "No teacher assigned" row.
// - Attendance: every student expected today (scheduleForDate) should be
//   marked. An unmarked student only counts as missing once their tardy cutoff
//   has passed; before that they're "not due yet".
// - Quran: every student expected today who isn't absent or excused should
//   have a lesson logged today.
// - A student whose parent reported them absent (pending/unexcused report) and
//   who is still unmarked is the admin's to resolve, not the teacher's — they
//   are left out of both checks.

import type { SchoolCalendarConfig } from "@/lib/schedule/calendar";
import {
  scheduleForDate,
  timeToMinutes,
  type DefaultSchedule,
  type ScheduleGroup,
} from "@/lib/schedule/student-schedule";

// ── Types ────────────────────────────────────────────────────────────────────

export type AccountabilityAttendance = "present" | "tardy" | "absent" | "excused";

export type AccountabilityStudent = {
  id: string;
  name: string;
  groupId: string | null;
  attendance: AccountabilityAttendance | null;
  quranLogged: boolean;
  reportedAbsent: boolean;
};

export type StaffMember = { id: string; name: string };

export type ChecklistStudent = { id: string; name: string };

export type TeacherChecklist = {
  /** null = students with no responsible teacher. */
  teacherId: string | null;
  teacherName: string;
  groupNames: string[];
  expected: number;
  attendance: {
    marked: number;
    /** Unmarked and past their tardy cutoff. */
    missing: ChecklistStudent[];
    /** Unmarked but not due yet. */
    notDueYet: number;
  };
  quran: {
    expected: number;
    logged: number;
    missing: ChecklistStudent[];
  };
  /** Nothing missing and nothing still to come. */
  complete: boolean;
};

export const UNASSIGNED_LABEL = "No teacher assigned";

// ── Planning ─────────────────────────────────────────────────────────────────

export function buildStaffChecklist(input: {
  date: string;
  nowMinutes: number;
  students: AccountabilityStudent[];
  groups: ScheduleGroup[];
  /** group id → teacher profile id */
  groupTeachers: Map<string, string>;
  staff: StaffMember[];
  calendar: SchoolCalendarConfig;
  defaults: DefaultSchedule;
}): TeacherChecklist[] {
  const groupsById = new Map(input.groups.map((group) => [group.id, group]));
  const staffById = new Map(input.staff.map((member) => [member.id, member]));
  const rows = new Map<string, TeacherChecklist>();

  for (const student of input.students) {
    const group = student.groupId ? groupsById.get(student.groupId) ?? null : null;
    const schedule = scheduleForDate(input.date, group, input.calendar, input.defaults);
    if (!schedule) continue;
    if (student.reportedAbsent && student.attendance === null) continue;

    const assignedId = group ? input.groupTeachers.get(group.id) ?? null : null;
    // A teacher who was deleted / demoted shows up as unassigned.
    const teacher = assignedId ? staffById.get(assignedId) ?? null : null;
    const key = teacher?.id ?? "unassigned";
    const row =
      rows.get(key) ??
      ({
        teacherId: teacher?.id ?? null,
        teacherName: teacher?.name ?? UNASSIGNED_LABEL,
        groupNames: [],
        expected: 0,
        attendance: { marked: 0, missing: [], notDueYet: 0 },
        quran: { expected: 0, logged: 0, missing: [] },
        complete: false,
      } satisfies TeacherChecklist);
    rows.set(key, row);

    const groupName = schedule.groupName ?? "School-wide";
    if (!row.groupNames.includes(groupName)) row.groupNames.push(groupName);
    row.expected += 1;

    const item = { id: student.id, name: student.name };
    if (student.attendance !== null) {
      row.attendance.marked += 1;
    } else if (input.nowMinutes > timeToMinutes(schedule.tardyCutoffTime)) {
      row.attendance.missing.push(item);
    } else {
      row.attendance.notDueYet += 1;
    }

    if (student.attendance !== "absent" && student.attendance !== "excused") {
      row.quran.expected += 1;
      if (student.quranLogged) row.quran.logged += 1;
      else row.quran.missing.push(item);
    }
  }

  const result = Array.from(rows.values());
  for (const row of result) {
    row.groupNames.sort();
    row.attendance.missing.sort((a, b) => a.name.localeCompare(b.name));
    row.quran.missing.sort((a, b) => a.name.localeCompare(b.name));
    row.complete =
      row.attendance.missing.length === 0 &&
      row.attendance.notDueYet === 0 &&
      row.quran.missing.length === 0;
  }

  // Outstanding teachers first, then by name; unassigned always last.
  return result.sort((a, b) => {
    if ((a.teacherId === null) !== (b.teacherId === null)) return a.teacherId === null ? 1 : -1;
    if (a.complete !== b.complete) return a.complete ? 1 : -1;
    return a.teacherName.localeCompare(b.teacherName);
  });
}
