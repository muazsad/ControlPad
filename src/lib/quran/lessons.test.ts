import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isRevision, lessonTypeOf, parseJuzList, sabaqOnly, sabaqTotalLines } from "./lessons";

describe("sabaq-only totals", () => {
  const entries = [
    { lesson_type: "sabaq", lines_memorized: 5 },
    { lesson_type: "sabaq_para", lines_memorized: 20 },
    { lesson_type: "dhor", lines_memorized: 40 },
    { lesson_type: "sabaq", lines_memorized: "2.5" },
    { lines_memorized: 3 }, // pre-migration row: counts as sabaq
  ];

  it("sums only sabaq lines from raw entries", () => {
    assert.equal(sabaqTotalLines(entries), 10.5);
  });

  it("filters out revision entries", () => {
    assert.equal(sabaqOnly(entries).length, 3);
    assert.equal(isRevision({ lesson_type: "dhor" }), true);
    assert.equal(lessonTypeOf({ lesson_type: null }), "sabaq");
  });
});

describe("parseJuzList", () => {
  it("parses commas and spaces, dedupes and sorts", () => {
    assert.deepEqual(parseJuzList(" 7, 3 3 12 "), { ok: true, juz: [3, 7, 12] });
    assert.deepEqual(parseJuzList(""), { ok: true, juz: [] });
  });

  it("rejects out-of-range and non-numbers", () => {
    assert.equal(parseJuzList("0").ok, false);
    assert.equal(parseJuzList("31").ok, false);
    assert.equal(parseJuzList("3, x").ok, false);
    assert.equal(parseJuzList("2.5").ok, false);
  });
});
