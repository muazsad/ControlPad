import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ANNOUNCEMENT_MAX_LENGTH,
  announcementBody,
  announcementRecipients,
  audienceLabel,
  easternToUtc,
  parseAnnouncementForm,
  smsSegments,
  UNGROUPED,
} from "./announcements";

const students = [
  { groupId: "full", guardians: [{ phone: "+14135550101" }, { phone: null }] },
  // Sibling: same family phone only texted once.
  { groupId: "quran", guardians: [{ phone: "+14135550101" }] },
  { groupId: "quran", guardians: [{ phone: "+14135550202" }] },
  { groupId: null, guardians: [{ phone: "+14135550303" }] },
];

describe("announcementRecipients", () => {
  it("texts every family once for all parents", () =>
    assert.deepEqual(announcementRecipients(null, students), [
      "+14135550101",
      "+14135550202",
      "+14135550303",
    ]));

  it("filters to chosen groups, including students without a group", () => {
    assert.deepEqual(announcementRecipients(["quran"], students), ["+14135550101", "+14135550202"]);
    assert.deepEqual(announcementRecipients([UNGROUPED], students), ["+14135550303"]);
  });
});

describe("message helpers", () => {
  it("adds the school prefix once", () => {
    assert.equal(announcementBody(" No school Monday "), "Salaam Institute: No school Monday");
    assert.equal(announcementBody("Salaam Institute: hi"), "Salaam Institute: hi");
  });

  it("counts SMS segments", () => {
    assert.equal(smsSegments("a".repeat(160)), 1);
    assert.equal(smsSegments("a".repeat(161)), 2);
    assert.equal(smsSegments("Eid Mubarak 🌙"), 1);
    assert.equal(smsSegments("é".repeat(71)), 2);
  });

  it("labels audiences", () => {
    const names = new Map([["quran", "Quran only"]]);
    assert.equal(audienceLabel(null, names), "All parents");
    assert.equal(audienceLabel(["quran", UNGROUPED], names), "Quran only, Students without a group");
  });
});

describe("easternToUtc", () => {
  it("handles daylight and standard time", () => {
    assert.equal(easternToUtc("2026-10-15", "19:00").toISOString(), "2026-10-15T23:00:00.000Z");
    assert.equal(easternToUtc("2026-12-15", "08:00").toISOString(), "2026-12-15T13:00:00.000Z");
  });
});

describe("parseAnnouncementForm", () => {
  const now = new Date("2026-10-12T14:00:00.000Z"); // 10:00 AM EDT, Monday
  const context = { validGroupKeys: new Set(["full", "quran", UNGROUPED]), now };
  const base = { message: "No school Friday", audience: "all", groups: [], when: "now", date: "", time: "" };

  it("accepts send-now to all parents", () => {
    const result = parseAnnouncementForm(base, context);
    assert.deepEqual(result, {
      ok: true,
      values: { message: "No school Friday", audience: null, sendNow: true, sendAt: now },
    });
  });

  it("requires a message within the limit", () => {
    assert.equal(parseAnnouncementForm({ ...base, message: "  " }, context).ok, false);
    assert.equal(
      parseAnnouncementForm({ ...base, message: "x".repeat(ANNOUNCEMENT_MAX_LENGTH + 1) }, context).ok,
      false,
    );
  });

  it("requires valid groups", () => {
    assert.equal(parseAnnouncementForm({ ...base, audience: "groups" }, context).ok, false);
    assert.equal(
      parseAnnouncementForm({ ...base, audience: "groups", groups: ["gone"] }, context).ok,
      false,
    );
    const ok = parseAnnouncementForm({ ...base, audience: "groups", groups: ["quran", "full", "quran"] }, context);
    assert.ok(ok.ok && JSON.stringify(ok.values.audience) === JSON.stringify(["full", "quran"]));
  });

  it("schedules in Eastern time inside the allowed window", () => {
    const result = parseAnnouncementForm(
      { ...base, when: "schedule", date: "2026-10-15", time: "18:30" },
      context,
    );
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.values.sendNow, false);
      assert.equal(result.values.sendAt.toISOString(), "2026-10-15T22:30:00.000Z");
    }
  });

  it("rejects times outside the window or in the past", () => {
    for (const time of ["07:59", "19:00"]) {
      assert.equal(
        parseAnnouncementForm({ ...base, when: "schedule", date: "2026-10-15", time }, context).ok,
        false,
      );
    }
    assert.equal(
      parseAnnouncementForm({ ...base, when: "schedule", date: "2026-10-12", time: "09:00" }, context).ok,
      false,
    );
  });
});
