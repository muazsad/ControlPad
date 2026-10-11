import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_WEEKLY_PATTERN, type SchoolCalendarConfig } from "@/lib/schedule/calendar";

import {
  REVISION_WARNING_FRACTION,
  formatJuzList,
  juzRevisionStatuses,
  lastRevisionDate,
  revisionOverdueMessage,
  revisionTone,
  sabaqWithoutRevision,
} from "./revision";

function calendar(partial: Partial<SchoolCalendarConfig> = {}): SchoolCalendarConfig {
  return { weeklyPattern: DEFAULT_WEEKLY_PATTERN, breaks: [], specialDays: [], ...partial };
}

// Default week: Mon–Thu + Sat. Oct 5 2026 is a Monday.
const base = { asOfDate: "2026-10-12", thresholdSchoolDays: 5, calendar: calendar() };

describe("juzRevisionStatuses", () => {
  it("uses marked_at when a juz has never been revised", () => {
    const [status] = juzRevisionStatuses({
      ...base,
      memorized: [{ juz: 3, markedAt: "2026-10-03" }], // Sat; after it: 5,6,7,8,10,12 = 6
      entries: [],
    });
    assert.equal(status.lastRevisionDate, null);
    assert.equal(status.since, "2026-10-03");
    assert.equal(status.schoolDaysSince, 6);
    assert.equal(status.overdue, true);
    assert.equal(status.tone, "danger");
  });

  it("counts from the latest sabaq para or dhor for that juz, ignoring sabaq and other juz", () => {
    const [status] = juzRevisionStatuses({
      ...base,
      memorized: [{ juz: 3, markedAt: "2026-09-01" }],
      entries: [
        { date: "2026-10-06", lesson_type: "dhor", juz: 3 },
        { date: "2026-10-08", lesson_type: "sabaq_para", juz: 3 },
        { date: "2026-10-10", lesson_type: "sabaq", juz: 3 }, // sabaq is not revision
        { date: "2026-10-12", lesson_type: "dhor", juz: 7 }, // other juz
      ],
    });
    assert.equal(status.lastRevisionDate, "2026-10-08");
    assert.equal(status.schoolDaysSince, 2); // Oct 10, 12
    assert.equal(status.overdue, false);
  });

  it("does not count a break inside the gap", () => {
    const withBreak = calendar({
      breaks: [{ id: "b", name: "Break", startDate: "2026-10-05", endDate: "2026-10-10" }],
    });
    const [status] = juzRevisionStatuses({
      ...base,
      calendar: withBreak,
      memorized: [{ juz: 1, markedAt: "2026-10-03" }],
      entries: [],
    });
    assert.equal(status.schoolDaysSince, 1); // only Oct 12
    assert.equal(status.overdue, false);
  });

  it("treats a juz revised today as fresh", () => {
    const [status] = juzRevisionStatuses({
      ...base,
      memorized: [{ juz: 2, markedAt: "2026-01-01" }],
      entries: [{ date: "2026-10-12", lesson_type: "dhor", juz: 2 }],
    });
    assert.equal(status.schoolDaysSince, 0);
    assert.equal(status.tone, "success");
  });
});

describe("revisionTone", () => {
  it("warns past 70% of the threshold and is danger only when overdue", () => {
    assert.equal(REVISION_WARNING_FRACTION, 0.7);
    assert.equal(revisionTone(14, 20), "success");
    assert.equal(revisionTone(15, 20), "warning");
    assert.equal(revisionTone(20, 20), "warning");
    assert.equal(revisionTone(21, 20), "danger");
  });
});

describe("sabaqWithoutRevision", () => {
  const sabaq = (date: string) => ({ date, lesson_type: "sabaq" });

  it("flags 3+ sabaq entries with no revision in the last 10 school days", () => {
    const result = sabaqWithoutRevision({
      entries: [sabaq("2026-10-06"), sabaq("2026-10-08"), sabaq("2026-10-12")],
      asOfDate: "2026-10-12",
      calendar: calendar(),
    });
    assert.deepEqual(result, { flagged: true, sabaqCount: 3, revisionCount: 0 });
  });

  it("does not flag when any revision happened in the window", () => {
    const result = sabaqWithoutRevision({
      entries: [
        sabaq("2026-10-06"),
        sabaq("2026-10-08"),
        sabaq("2026-10-12"),
        { date: "2026-10-07", lesson_type: "dhor", juz: 1 },
      ],
      asOfDate: "2026-10-12",
      calendar: calendar(),
    });
    assert.equal(result.flagged, false);
  });

  it("does not flag with too few sabaq entries or entries outside the window", () => {
    const result = sabaqWithoutRevision({
      entries: [sabaq("2026-08-01"), sabaq("2026-08-02"), sabaq("2026-10-12")],
      asOfDate: "2026-10-12",
      calendar: calendar(),
    });
    assert.equal(result.sabaqCount, 1);
    assert.equal(result.flagged, false);
  });
});

describe("revision SMS", () => {
  it("caps the juz list", () => {
    assert.equal(formatJuzList([3]), "Juz 3");
    assert.equal(formatJuzList([7, 3]), "Juz 3 and 7");
    assert.equal(formatJuzList([12, 3, 7, 20]), "Juz 3, 7 and 2 more");
  });

  it("builds the parent/admin text", () => {
    assert.equal(
      revisionOverdueMessage("Yusuf Ali", [3, 7, 12, 20]),
      "Salaam Institute: Yusuf hasn't revised Juz 3, 7 and 2 more in over a month. Please encourage review at home.",
    );
  });
});

describe("lastRevisionDate", () => {
  it("is the latest revision date, ignoring sabaq", () => {
    assert.equal(
      lastRevisionDate([
        { date: "2026-10-01", lesson_type: "dhor" },
        { date: "2026-10-09", lesson_type: "sabaq_para" },
        { date: "2026-10-11", lesson_type: "sabaq" },
      ]),
      "2026-10-09",
    );
    assert.equal(lastRevisionDate([{ date: "2026-10-11", lesson_type: "sabaq" }]), null);
  });
});
