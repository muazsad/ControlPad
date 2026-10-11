import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attendanceForDecision, parseReviewDecision, reportNote } from "./review";

describe("attendanceForDecision", () => {
  it("excused → excused, unexcused → absent", () => {
    assert.deepEqual(attendanceForDecision("excused", null), { status: "excused" });
    assert.deepEqual(attendanceForDecision("unexcused", "absent"), { status: "absent" });
  });

  it("dismiss leaves attendance alone", () =>
    assert.deepEqual(attendanceForDecision("dismissed", "present"), { status: null }));

  it("won't overwrite a student who came in", () => {
    const result = attendanceForDecision("excused", "tardy");
    assert.ok("error" in result);
  });
});

describe("helpers", () => {
  it("parses decisions", () => {
    assert.equal(parseReviewDecision("excused"), "excused");
    assert.equal(parseReviewDecision("approve"), null);
  });
  it("builds the attendance note", () =>
    assert.equal(reportNote("sick"), "Parent reported: sick"));
});
