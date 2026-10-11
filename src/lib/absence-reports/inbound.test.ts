import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SendSmsInput, SmsResult } from "@/lib/sms/send-sms";

import { handleInboundSms, type InboundDatabase } from "./inbound";
import type { InboundChild, PendingFollowUp } from "./parse";

// 2026-10-12 09:00 Eastern (EDT = UTC-4).
const morning = new Date("2026-10-12T13:00:00.000Z");

function fakeDatabase(options: {
  guardians?: { id: string; fullName: string }[];
  children?: InboundChild[];
  followUp?: PendingFollowUp | null;
  existingSid?: string;
}) {
  const inbound: Record<string, unknown>[] = [];
  const reports: Record<string, unknown>[] = [];
  const resolved: string[] = [];
  const database: InboundDatabase = {
    async inboundSidExists(sid) {
      return sid === options.existingSid;
    },
    async findGuardiansByPhone() {
      return options.guardians ?? [];
    },
    async getChildren() {
      return options.children ?? [];
    },
    async findPendingFollowUp() {
      return options.followUp ?? null;
    },
    async insertInbound(row) {
      inbound.push(row);
      return { id: `in${inbound.length}` };
    },
    async resolveFollowUp(id) {
      resolved.push(id);
    },
    async insertReports(rows) {
      reports.push(...rows);
      return rows.length;
    },
    async getAdminPhones() {
      return ["+14135559999"];
    },
  };
  return { database, inbound, reports, resolved };
}

function recorder() {
  const sent: SendSmsInput[] = [];
  return {
    sent,
    sendSms: async (input: SendSmsInput): Promise<SmsResult> => {
      sent.push(input);
      return { status: "dry_run", notification: null };
    },
  };
}

const guardian = { id: "g1", fullName: "Fatima Khan" };
const amina = { id: "s1", firstName: "Amina", lastName: "Khan" };
const yusuf = { id: "s2", firstName: "Yusuf", lastName: "Khan" };

describe("handleInboundSms", () => {
  it("records a report for an only child and acknowledges the parent", async () => {
    const db = fakeDatabase({ guardians: [guardian], children: [amina] });
    const sms = recorder();
    const result = await handleInboundSms(
      { from: "(413) 555-0101", body: "Amina is sick today", twilioSid: "SM1", now: morning },
      { database: db.database, sendSms: sms.sendSms },
    );

    assert.equal(result.outcome, "absence_report");
    assert.equal(result.reportsCreated, 1);
    assert.equal(db.inbound[0].from_phone, "+14135550101");
    assert.deepEqual(db.reports[0], {
      student_id: "s1",
      guardian_id: "g1",
      inbound_message_id: "in1",
      date: "2026-10-12",
      reason: "Amina is sick today",
    });
    assert.equal(sms.sent.length, 1);
    assert.equal(sms.sent[0].recipientPhone, "+14135550101");
    assert.equal(sms.sent[0].triggerType, "absence_report_reply");
    assert.equal(sms.sent[0].dedupeKey, "inbound:in1");
  });

  it("asks which child, then completes the report from the reply", async () => {
    const first = fakeDatabase({ guardians: [guardian], children: [amina, yusuf] });
    const sms = recorder();
    const asked = await handleInboundSms(
      { from: "+14135550101", body: "sick today", twilioSid: "SM1", now: morning },
      { database: first.database, sendSms: sms.sendSms },
    );
    assert.equal(asked.outcome, "needs_child");
    assert.equal(first.inbound[0].pending_date, "2026-10-12");
    assert.match(sms.sent[0].body, /Which child/);

    const second = fakeDatabase({
      guardians: [guardian],
      children: [amina, yusuf],
      followUp: { id: "in1", date: "2026-10-12", reason: "sick today" },
    });
    const done = await handleInboundSms(
      { from: "+14135550101", body: "Yusuf", twilioSid: "SM2", now: morning },
      { database: second.database, sendSms: sms.sendSms },
    );
    assert.equal(done.outcome, "absence_report");
    assert.equal(second.reports[0].student_id, "s2");
    assert.equal(second.reports[0].reason, "sick today");
    assert.deepEqual(second.resolved, ["in1"]);
  });

  it("forwards other texts to the admin with the parent's name", async () => {
    const db = fakeDatabase({ guardians: [guardian], children: [amina] });
    const sms = recorder();
    const result = await handleInboundSms(
      { from: "+14135550101", body: "Running late, there by 9", twilioSid: "SM1", now: morning },
      { database: db.database, sendSms: sms.sendSms },
    );
    assert.equal(result.outcome, "forwarded");
    assert.equal(db.reports.length, 0);
    assert.equal(sms.sent[0].recipientPhone, "+14135559999");
    assert.equal(sms.sent[0].triggerType, "parent_message");
    assert.match(sms.sent[0].body, /Fatima Khan \(parent of Amina Khan\)/);
  });

  it("forwards texts from unknown numbers", async () => {
    const db = fakeDatabase({});
    const sms = recorder();
    const result = await handleInboundSms(
      { from: "+14135550199", body: "Is school open?", twilioSid: "SM1", now: morning },
      { database: db.database, sendSms: sms.sendSms },
    );
    assert.equal(result.outcome, "forwarded");
    assert.match(sms.sent[0].body, /unknown number \+14135550199/);
  });

  it("logs STOP without replying", async () => {
    const db = fakeDatabase({ guardians: [guardian], children: [amina] });
    const sms = recorder();
    const result = await handleInboundSms(
      { from: "+14135550101", body: "STOP", twilioSid: "SM1", now: morning },
      { database: db.database, sendSms: sms.sendSms },
    );
    assert.equal(result.outcome, "ignored");
    assert.equal(db.inbound.length, 1);
    assert.equal(sms.sent.length, 0);
  });

  it("ignores a Twilio retry of the same message", async () => {
    const db = fakeDatabase({ guardians: [guardian], children: [amina], existingSid: "SM1" });
    const sms = recorder();
    const result = await handleInboundSms(
      { from: "+14135550101", body: "Amina sick", twilioSid: "SM1", now: morning },
      { database: db.database, sendSms: sms.sendSms },
    );
    assert.equal(result.outcome, "duplicate");
    assert.equal(db.inbound.length, 0);
    assert.equal(sms.sent.length, 0);
  });
});
