import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatJuzPages,
  isRevision,
  lessonTypeOf,
  parseJuzList,
  parseJuzPages,
  sabaqOnly,
  sabaqTotalLines,
} from "./lessons";

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

describe("parseJuzPages", () => {
  it("parses juz with page ranges or single pages", () => {
    assert.deepEqual(parseJuzPages("3: 1-5"), {
      ok: true,
      entries: [{ juz: 3, fromPage: 1, toPage: 5 }],
    });
    assert.deepEqual(parseJuzPages(" 7:10–20 , 3 : 4 "), {
      ok: true,
      entries: [
        { juz: 3, fromPage: 4, toPage: 4 },
        { juz: 7, fromPage: 10, toPage: 20 },
      ],
    });
    assert.deepEqual(parseJuzPages(""), { ok: true, entries: [] });
  });

  it("keeps two sections of the same juz", () => {
    const result = parseJuzPages("3: 10-12, 3: 1-5");
    assert.deepEqual(result.ok && result.entries.map((e) => e.fromPage), [1, 10]);
  });

  it("requires pages for every juz", () => {
    const result = parseJuzPages("3");
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.error : "", /pages for juz 3/);
    assert.equal(parseJuzPages("3: 1-5, 7").ok, false);
  });

  it("rejects bad juz, bad pages and backwards ranges", () => {
    assert.equal(parseJuzPages("31: 1-5").ok, false);
    assert.equal(parseJuzPages("3: 0-5").ok, false);
    assert.equal(parseJuzPages("3: 1-31").ok, false);
    assert.equal(parseJuzPages("3: 9-2").ok, false);
    assert.equal(parseJuzPages("3: x").ok, false);
  });

  it("formats a section for display", () => {
    assert.equal(formatJuzPages({ juz: 3, fromPage: 1, toPage: 5 }), "Juz 3 · p. 1–5");
    assert.equal(formatJuzPages({ juz: 3, fromPage: 4, toPage: 4 }), "Juz 3 · p. 4");
    assert.equal(formatJuzPages({ juz: 3, fromPage: null, toPage: null }), "Juz 3");
  });
});
