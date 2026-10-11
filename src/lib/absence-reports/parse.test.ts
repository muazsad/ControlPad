import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acknowledgementMessage,
  askWhichChildMessage,
  isCarrierKeyword,
  looksLikeAbsence,
  matchChildren,
  planInboundSms,
  reportDate,
  type InboundChild,
} from "./parse";

const amina: InboundChild = { id: "s1", firstName: "Amina", lastName: "Khan" };
const yusuf: InboundChild = { id: "s2", firstName: "Yusuf", lastName: "Khan" };
const morning = { date: "2026-10-12", minutes: 7 * 60 + 30 };
const evening = { date: "2026-10-12", minutes: 20 * 60 };

describe("looksLikeAbsence", () => {
  for (const text of [
    "Amina sick today",
    "She won't be coming in today",
    "Yusuf has a doctor appointment",
    "keeping him home today",
    "Amina is absent",
    "they wont be in tomorrow",
    "We can't make it today, family emergency",
  ]) {
    it(`recognizes "${text}"`, () => assert.equal(looksLikeAbsence(text), true));
  }

  for (const text of ["Thanks!", "Running late, be there at 9", "What time is pickup?", "ok"]) {
    it(`does not treat "${text}" as an absence`, () =>
      assert.equal(looksLikeAbsence(text), false));
  }
});

describe("isCarrierKeyword", () => {
  it("ignores opt-out and help keywords", () => {
    assert.equal(isCarrierKeyword("STOP"), true);
    assert.equal(isCarrierKeyword(" help "), true);
    assert.equal(isCarrierKeyword("stop texting about late"), false);
  });
});

describe("reportDate", () => {
  it("defaults to today in the morning", () =>
    assert.equal(reportDate("Amina sick", morning), "2026-10-12"));
  it("uses tomorrow when the text says so", () =>
    assert.equal(reportDate("Amina out tomorrow", morning), "2026-10-13"));
  it("treats an evening text with no date word as tomorrow", () =>
    assert.equal(reportDate("Amina sick", evening), "2026-10-13"));
  it("respects an explicit today in the evening", () =>
    assert.equal(reportDate("Amina was sick today", evening), "2026-10-12"));
});

describe("matchChildren", () => {
  it("matches by first name, case-insensitive", () =>
    assert.deepEqual(matchChildren("yusuf is sick", [amina, yusuf]), [yusuf]));
  it("matches both / all / kids", () =>
    assert.deepEqual(matchChildren("both are sick", [amina, yusuf]), [amina, yusuf]));
  it("does not match a name inside another word", () =>
    assert.deepEqual(
      matchChildren("ali sick", [{ id: "x", firstName: "Al", lastName: "B" }]),
      [],
    ));
});

describe("planInboundSms", () => {
  const base = { knownSender: true, clock: morning, followUp: null };

  it("ignores carrier keywords before anything else", () =>
    assert.deepEqual(
      planInboundSms({ ...base, body: "STOP", knownSender: false, children: [] }),
      { kind: "ignored" },
    ));

  it("forwards texts from unknown numbers", () =>
    assert.deepEqual(
      planInboundSms({ ...base, body: "Amina sick", knownSender: false, children: [] }),
      { kind: "forward", why: "unknown_sender" },
    ));

  it("forwards non-absence texts", () =>
    assert.deepEqual(
      planInboundSms({ ...base, body: "Running late", children: [amina] }),
      { kind: "forward", why: "not_absence" },
    ));

  it("reports an only child without needing a name", () => {
    const plan = planInboundSms({ ...base, body: "sick today", children: [amina] });
    assert.equal(plan.kind, "report");
    if (plan.kind !== "report") return;
    assert.deepEqual(plan.children, [amina]);
    assert.equal(plan.date, "2026-10-12");
    assert.equal(plan.reason, "sick today");
  });

  it("asks which child when a parent of several doesn't name one", () => {
    const plan = planInboundSms({ ...base, body: "sick today", children: [amina, yusuf] });
    assert.equal(plan.kind, "ask_child");
  });

  it("completes an earlier question when the parent replies with a name", () => {
    const plan = planInboundSms({
      ...base,
      body: "Yusuf",
      children: [amina, yusuf],
      followUp: { id: "in1", date: "2026-10-12", reason: "sick today" },
    });
    assert.deepEqual(plan, {
      kind: "report",
      children: [yusuf],
      date: "2026-10-12",
      reason: "sick today",
      resolvesFollowUpId: "in1",
    });
  });

  it("completes an earlier question with ALL", () => {
    const plan = planInboundSms({
      ...base,
      body: "All",
      children: [amina, yusuf],
      followUp: { id: "in1", date: "2026-10-12", reason: "sick" },
    });
    assert.equal(plan.kind, "report");
    if (plan.kind === "report") assert.deepEqual(plan.children, [amina, yusuf]);
  });

  it("forwards an unrelated reply to a pending question", () =>
    assert.deepEqual(
      planInboundSms({
        ...base,
        body: "thanks",
        children: [amina, yusuf],
        followUp: { id: "in1", date: "2026-10-12", reason: "sick" },
      }),
      { kind: "forward", why: "not_absence" },
    ));
});

describe("messages", () => {
  it("acknowledges today and tomorrow", () => {
    assert.match(
      acknowledgementMessage([amina], "2026-10-12", "2026-10-12"),
      /Amina will be absent today \(Mon, Oct 12\)/,
    );
    assert.match(
      acknowledgementMessage([amina, yusuf], "2026-10-13", "2026-10-12"),
      /Amina and Yusuf will be absent tomorrow/,
    );
  });

  it("lists the children when asking which one", () =>
    assert.match(askWhichChildMessage([amina, yusuf]), /\(Amina, Yusuf\) or ALL/));
});
