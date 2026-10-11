import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SendSmsInput } from "@/lib/sms/send-sms";
import type { SpecialDay } from "@/lib/schedule/calendar";

import {
  sendSpecialDayNotice,
  shouldAutoSendSpecialDayNotice,
  specialDayDedupeKey,
  specialDayNoticeBody,
  specialDayRecipients,
  type SpecialDayNoticeDatabase,
  type SpecialDayStudent,
} from "./special-day";

const students: SpecialDayStudent[] = [
  { groupId: null, guardians: [{ phone: "+14135550101" }, { phone: null }] },
  // Sibling — same parent phone should only be texted once.
  { groupId: null, guardians: [{ phone: "+14135550101" }] },
  { groupId: "quran-only", guardians: [{ phone: "+14135550202" }] },
];

const fieldTrip: SpecialDay = {
  date: "2026-10-22",
  type: "field_trip",
  parentMessage: "Field trip Thursday. Pack a lunch.",
  notifyParents: true,
};

describe("specialDayRecipients", () => {
  it("texts each parent once, for students in scope", () => {
    assert.deepEqual(specialDayRecipients(fieldTrip, students), [
      "+14135550101",
      "+14135550202",
    ]);
    assert.deepEqual(
      specialDayRecipients({ ...fieldTrip, appliesTo: ["quran-only"] }, students),
      ["+14135550202"],
    );
    assert.deepEqual(
      specialDayRecipients({ ...fieldTrip, appliesTo: ["ungrouped"] }, students),
      ["+14135550101"],
    );
  });
});

describe("specialDayNoticeBody / dedupe key", () => {
  it("prefixes the school name once", () => {
    assert.equal(specialDayNoticeBody("No GCVS today."), "Salaam Institute: No GCVS today.");
    assert.equal(specialDayNoticeBody("Salaam Institute: hi"), "Salaam Institute: hi");
  });

  it("changes the key when the message changes", () => {
    assert.notEqual(
      specialDayDedupeKey("2026-10-22", "A"),
      specialDayDedupeKey("2026-10-22", "B"),
    );
    assert.equal(
      specialDayDedupeKey("2026-10-22", "A "),
      specialDayDedupeKey("2026-10-22", "A"),
    );
  });
});

describe("shouldAutoSendSpecialDayNotice", () => {
  const at = (today: string, time: string) => ({
    today,
    nowMinutes: Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)),
  });

  it("sends at 6pm the evening before, once", () => {
    assert.equal(shouldAutoSendSpecialDayNotice({ day: fieldTrip, ...at("2026-10-21", "17:50") }), false);
    assert.equal(shouldAutoSendSpecialDayNotice({ day: fieldTrip, ...at("2026-10-21", "18:00") }), true);
    assert.equal(shouldAutoSendSpecialDayNotice({ day: fieldTrip, ...at("2026-10-20", "18:00") }), false);
    assert.equal(
      shouldAutoSendSpecialDayNotice({
        day: { ...fieldTrip, parentsNotifiedAt: "2026-10-21T22:00:00Z" },
        ...at("2026-10-21", "18:10"),
      }),
      false,
    );
  });

  it("does nothing when auto-text is off or there's no message", () => {
    const evening = at("2026-10-21", "18:00");
    assert.equal(shouldAutoSendSpecialDayNotice({ day: { ...fieldTrip, notifyParents: false }, ...evening }), false);
    assert.equal(shouldAutoSendSpecialDayNotice({ day: { ...fieldTrip, parentMessage: "  " }, ...evening }), false);
    assert.equal(shouldAutoSendSpecialDayNotice({ day: undefined, ...evening }), false);
  });
});

describe("sendSpecialDayNotice", () => {
  it("sends one text per parent and records when it went out", async () => {
    const notified: string[] = [];
    const database: SpecialDayNoticeDatabase = {
      getSpecialDay: async () => fieldTrip,
      getActiveStudents: async () => students,
      markNotified: async (date) => {
        notified.push(date);
      },
    };
    const sent: SendSmsInput[] = [];
    const result = await sendSpecialDayNotice(
      { date: "2026-10-22" },
      {
        database,
        sendSms: async (input) => {
          sent.push(input);
          return { status: "dry_run", notification: {} };
        },
      },
    );

    assert.equal(result.sent, true);
    assert.equal(result.recipients, 2);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].triggerType, "special_day");
    assert.equal(sent[0].studentId, null);
    assert.match(sent[0].body, /^Salaam Institute: Field trip Thursday/);
    assert.equal(sent[0].dedupeKey, specialDayDedupeKey("2026-10-22", fieldTrip.parentMessage!));
    assert.deepEqual(notified, ["2026-10-22"]);
  });

  it("refuses when there's no message", async () => {
    const result = await sendSpecialDayNotice(
      { date: "2026-10-22" },
      {
        database: {
          getSpecialDay: async () => ({ ...fieldTrip, parentMessage: null }),
          getActiveStudents: async () => students,
          markNotified: async () => {
            throw new Error("should not mark");
          },
        },
        sendSms: async () => {
          throw new Error("should not send");
        },
      },
    );
    assert.equal(result.sent, false);
  });
});
