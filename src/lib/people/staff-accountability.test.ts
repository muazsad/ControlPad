import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_WEEKLY_PATTERN, type SchoolCalendarConfig } from "@/lib/schedule/calendar";
import type { ScheduleGroup } from "@/lib/schedule/student-schedule";

import {
  buildStaffChecklist,
  UNASSIGNED_LABEL,
  type AccountabilityStudent,
} from "./staff-accountability";

const calendar: SchoolCalendarConfig = {
  weeklyPattern: DEFAULT_WEEKLY_PATTERN,
  breaks: [],
  specialDays: [],
};

const weekdays = [1, 2, 3, 4, 6];
const groups: ScheduleGroup[] = [
  {
    id: "full",
    name: "Full time",
    days: weekdays.map((weekday) => ({
      weekday,
      startTime: "08:00",
      tardyGraceMinutes: 10,
      absenceCheckTime: "10:00",
    })),
  },
  {
    id: "quran",
    name: "Quran only",
    days: weekdays.map((weekday) => ({
      weekday,
      startTime: "16:00",
      tardyGraceMinutes: 10,
      absenceCheckTime: "16:30",
    })),
  },
];
const defaults = { schoolStart: "08:00", tardyWindowHours: 2 };
const staff = [
  { id: "t1", name: "Ustadh Ali" },
  { id: "t2", name: "Ustadha Mariam" },
];
const MONDAY = "2026-10-12";
const at = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

function student(
  id: string,
  groupId: string | null,
  attendance: AccountabilityStudent["attendance"],
  quranLogged = false,
  reportedAbsent = false,
): AccountabilityStudent {
  return { id, name: `Student ${id}`, groupId, attendance, quranLogged, reportedAbsent };
}

function build(students: AccountabilityStudent[], now: string, teachers = [["full", "t1"], ["quran", "t2"]]) {
  return buildStaffChecklist({
    date: MONDAY,
    nowMinutes: at(now),
    students,
    groups,
    groupTeachers: new Map(teachers as [string, string][]),
    staff,
    calendar,
    defaults,
  });
}

describe("buildStaffChecklist", () => {
  it("groups students under their group's teacher and counts gaps", () => {
    const rows = build(
      [
        student("a", "full", "present", true),
        student("b", "full", null),
        student("c", "full", "tardy", false),
        student("d", "full", "absent"),
      ],
      "12:00",
    );
    assert.equal(rows.length, 1);
    const [ali] = rows;
    assert.equal(ali.teacherName, "Ustadh Ali");
    assert.deepEqual(ali.groupNames, ["Full time"]);
    assert.equal(ali.expected, 4);
    assert.equal(ali.attendance.marked, 3);
    assert.deepEqual(ali.attendance.missing.map((s) => s.id), ["b"]);
    // Absent student "d" isn't expected to have Quran; "b" (unmarked) and "c" are missing.
    assert.equal(ali.quran.expected, 3);
    assert.equal(ali.quran.logged, 1);
    assert.deepEqual(ali.quran.missing.map((s) => s.id), ["b", "c"]);
    assert.equal(ali.complete, false);
  });

  it("doesn't count unmarked students before their tardy cutoff", () => {
    const [mariam] = build([student("q", "quran", null)], "16:05");
    assert.equal(mariam.attendance.missing.length, 0);
    assert.equal(mariam.attendance.notDueYet, 1);
    assert.equal(mariam.complete, false);
  });

  it("skips students not expected today", () => {
    const rows = build([student("q", "quran", null)], "12:00");
    // Quran-only students are expected Monday at 16:00 → still listed (not due yet).
    assert.equal(rows[0].attendance.notDueYet, 1);
    assert.equal(build([student("a", "full", null)], "12:00").length, 1);
    // Friday is off for everyone.
    const friday = buildStaffChecklist({
      date: "2026-10-16",
      nowMinutes: at("12:00"),
      students: [student("a", "full", null)],
      groups,
      groupTeachers: new Map(),
      staff,
      calendar,
      defaults,
    });
    assert.equal(friday.length, 0);
  });

  it("leaves parent-reported, unmarked students to the admin", () => {
    const rows = build([student("a", "full", null, false, true)], "12:00");
    assert.equal(rows.length, 0);
  });

  it("puts ungrouped students and groups without a teacher in an unassigned row, last", () => {
    const rows = build(
      [student("a", "full", "present", true), student("u", null, null)],
      "12:00",
      [],
    );
    assert.deepEqual(rows.map((r) => r.teacherName), [UNASSIGNED_LABEL]);
    assert.deepEqual(rows[0].groupNames, ["Full time", "School-wide"]);

    const mixed = build(
      [student("a", "full", "present", true), student("u", null, null)],
      "12:00",
    );
    assert.deepEqual(mixed.map((r) => r.teacherName), ["Ustadh Ali", UNASSIGNED_LABEL]);
  });

  it("marks a teacher complete and sorts outstanding teachers first", () => {
    const rows = build(
      [student("a", "full", "present", true), student("q", "quran", "present", false)],
      "17:00",
    );
    assert.deepEqual(
      rows.map((r) => [r.teacherName, r.complete]),
      [
        ["Ustadha Mariam", false],
        ["Ustadh Ali", true],
      ],
    );
  });
});
