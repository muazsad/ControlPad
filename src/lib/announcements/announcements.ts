// Announcements: one-off texts to all parents or chosen schedule groups, sent
// now or at a scheduled time. Pure logic — sending is in send.ts.
// Spec: docs/superpowers/specs/2026-10-11-announcements-design.md
//
// Client-safe: imported by the compose form, so no server imports here.

// ── Tunable constants ────────────────────────────────────────────────────────

/** Longest message (3 standard SMS segments, before the school prefix). */
export const ANNOUNCEMENT_MAX_LENGTH = 450;

/**
 * Scheduled announcements must go out in this local (Eastern) window. The
 * 10-minute tick only runs 10:00–23:50 UTC, which covers 06:00–18:50 Eastern
 * all year; 08:00 keeps texts out of early-morning quiet hours.
 */
export const SCHEDULE_EARLIEST_TIME = "08:00";
export const SCHEDULE_LATEST_TIME = "18:50";

/** Dedupe window per recipient (keyed on the announcement id). */
export const ANNOUNCEMENT_DEDUPE_HOURS = 24 * 30;

/** Audience token for students without a schedule group. */
export const UNGROUPED = "ungrouped";

const PREFIX = "Salaam Institute: ";

// ── Types ────────────────────────────────────────────────────────────────────

/** null = all parents; otherwise schedule group ids and/or UNGROUPED. */
export type Audience = string[] | null;

export type AnnouncementStudent = {
  groupId: string | null;
  guardians: { phone: string | null }[];
};

export type AnnouncementFormInput = {
  message: string;
  audience: string; // "all" | "groups"
  groups: string[];
  when: string; // "now" | "schedule"
  date: string; // YYYY-MM-DD (Eastern), when scheduling
  time: string; // HH:MM (Eastern), when scheduling
};

export type ParsedAnnouncement = {
  message: string;
  audience: Audience;
  sendNow: boolean;
  sendAt: Date;
};

// ── Message ──────────────────────────────────────────────────────────────────

export function announcementBody(message: string): string {
  const trimmed = message.trim();
  return /^salaam institute/i.test(trimmed) ? trimmed : `${PREFIX}${trimmed}`;
}

/** Rough SMS segment count (GSM-7 vs Unicode), for the compose form. */
export function smsSegments(body: string): number {
  if (body.length === 0) return 0;
  const unicode = /[^\x00-\x7F]/.test(body);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return body.length <= single ? 1 : Math.ceil(body.length / multi);
}

// ── Audience ─────────────────────────────────────────────────────────────────

export function audienceIncludes(audience: Audience, groupId: string | null): boolean {
  if (audience === null) return true;
  return audience.includes(groupId ?? UNGROUPED);
}

/** Unique guardian phones for the audience — a family with siblings gets one text. */
export function announcementRecipients(
  audience: Audience,
  students: AnnouncementStudent[],
): string[] {
  const phones = new Set<string>();
  for (const student of students) {
    if (!audienceIncludes(audience, student.groupId)) continue;
    for (const guardian of student.guardians) {
      const phone = guardian.phone?.trim();
      if (phone) phones.add(phone);
    }
  }
  return Array.from(phones).sort();
}

export function audienceLabel(audience: Audience, groupNames: Map<string, string>): string {
  if (audience === null) return "All parents";
  return audience
    .map((key) => (key === UNGROUPED ? "Students without a group" : groupNames.get(key) ?? "Deleted group"))
    .join(", ");
}

// ── Time ─────────────────────────────────────────────────────────────────────

const SCHOOL_TIME_ZONE = "America/New_York";

/** School-local wall-clock date + minutes for an instant. */
export function easternClock(now: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHOOL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** The UTC instant for a school-local (Eastern) date and time, DST-aware. */
export function easternToUtc(date: string, time: string): Date {
  const target = Date.parse(`${date}T${time}:00.000Z`); // the wall-clock time, as if UTC
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const clock = easternClock(new Date(guess));
    const shown = Date.parse(`${clock.date}T00:00:00.000Z`) + clock.minutes * 60_000;
    const diff = target - shown;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

// ── Form parsing ─────────────────────────────────────────────────────────────

export function parseAnnouncementForm(
  input: AnnouncementFormInput,
  context: { validGroupKeys: Set<string>; now: Date },
): { ok: true; values: ParsedAnnouncement } | { ok: false; error: string } {
  const message = input.message.replace(/\s+\n/g, "\n").trim();
  if (!message) return { ok: false, error: "Write the message." };
  if (message.length > ANNOUNCEMENT_MAX_LENGTH) {
    return { ok: false, error: `Keep the message under ${ANNOUNCEMENT_MAX_LENGTH} characters.` };
  }

  let audience: Audience;
  if (input.audience === "all") {
    audience = null;
  } else if (input.audience === "groups") {
    const groups = Array.from(new Set(input.groups.map((group) => group.trim()).filter(Boolean)));
    if (groups.length === 0) return { ok: false, error: "Choose at least one group." };
    if (groups.some((group) => !context.validGroupKeys.has(group))) {
      return { ok: false, error: "One of the chosen groups no longer exists. Reload and try again." };
    }
    audience = groups.sort();
  } else {
    return { ok: false, error: "Choose who receives it." };
  }

  if (input.when === "now") {
    return { ok: true, values: { message, audience, sendNow: true, sendAt: context.now } };
  }
  if (input.when !== "schedule") return { ok: false, error: "Choose when to send it." };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: "Choose a date." };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) return { ok: false, error: "Choose a time." };
  const minutes = timeToMinutes(input.time);
  if (minutes < timeToMinutes(SCHEDULE_EARLIEST_TIME) || minutes > timeToMinutes(SCHEDULE_LATEST_TIME)) {
    return {
      ok: false,
      error: "Scheduled announcements can go out between 8:00 AM and 6:50 PM.",
    };
  }
  const sendAt = easternToUtc(input.date, input.time);
  if (sendAt.getTime() <= context.now.getTime()) {
    return { ok: false, error: "That time has already passed. Pick a later time or send now." };
  }
  return { ok: true, values: { message, audience, sendNow: false, sendAt } };
}
