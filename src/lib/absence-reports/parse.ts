// Pure logic for texts parents send to the school number: is it an absence,
// for which child, for which day, and what to reply. No I/O here — see
// inbound.ts for the database + SMS side.
// Spec: docs/superpowers/specs/2026-10-11-parent-absence-reports-design.md

// ── Tunable constants ────────────────────────────────────────────────────────

/** A text with no date word sent at/after this local time is about tomorrow. */
export const EVENING_CUTOFF_TIME = "18:00";

/** How long a "which child?" question waits for the parent's reply. */
export const FOLLOW_UP_WINDOW_MINUTES = 120;

/** Longest reason stored / quoted back to the admin. */
export const MAX_REASON_LENGTH = 300;

/** Carrier keywords Twilio answers itself (opt-out / opt-in / help). */
const CARRIER_KEYWORDS = new Set([
  "STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT",
  "START", "UNSTOP", "YES", "HELP", "INFO",
]);

/** Phrases that mean the child won't be in. Matched case-insensitively. */
const ABSENCE_PATTERNS: RegExp[] = [
  /\babsen(t|ce)\b/,
  /\b(sick|ill|unwell|fever|flu|vomit\w*|throwing up|stomach\s?ache|headache)\b/,
  /\b(doctor|dentist|appointment|appt|hospital|clinic)\b/,
  /\bnot (be )?(coming|going|attending)\b/,
  /\b(won'?t|wont|will not) be (coming|going|attending|in|there|at school)\b/,
  /\b(won'?t|wont|will not) (come|attend|make it)\b/,
  /\b(can'?t|cant|cannot|can not) (come|make it|attend|go)\b/,
  /\b(stay|staying|stays|keep|keeping|kept)\b.{0,30}\bhome\b/,
  /\bhome (sick|today|tomorrow)\b/,
  /\b(out|off) (today|tomorrow|tmrw|tmr)\b/,
  /\bmiss(ing)? (school|class|classes|today|tomorrow)\b/,
  /\b(emergency|funeral|vacation|out of town|traveling|travelling)\b/,
  /\bnot in (today|tomorrow)\b/,
];

/** "Running late" is not an absence — forward it to the admin instead. */
const LATE_PATTERN = /\blate\b/;

const ALL_CHILDREN_PATTERN = /\b(all|both|kids|children|everyone|all of them)\b/;
const TOMORROW_PATTERN = /\b(tomorrow|tmrw|tmr|tomorow|tommorow|tommorrow|tomorrw)\b/;
const TODAY_PATTERN = /\b(today|tdy|this morning)\b/;

// ── Types ────────────────────────────────────────────────────────────────────

export type InboundChild = { id: string; firstName: string; lastName: string };

/** An earlier "which child?" question still waiting for an answer. */
export type PendingFollowUp = { id: string; date: string; reason: string };

export type InboundPlan =
  | { kind: "ignored" }
  | { kind: "forward"; why: "unknown_sender" | "no_children" | "not_absence" }
  | {
      kind: "report";
      children: InboundChild[];
      date: string;
      reason: string;
      /** Set when this text answers an earlier "which child?" question. */
      resolvesFollowUpId: string | null;
    }
  | { kind: "ask_child"; date: string; reason: string; children: InboundChild[] };

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalize(body: string): string {
  return body.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function isCarrierKeyword(body: string): boolean {
  return CARRIER_KEYWORDS.has(body.trim().replace(/[.!]+$/, "").toUpperCase());
}

export function looksLikeAbsence(body: string): boolean {
  const text = normalize(body);
  if (LATE_PATTERN.test(text)) return false;
  return ABSENCE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Which day the text is about. "tomorrow" wins, then "today"; with neither,
 * texts sent in the evening are about tomorrow.
 */
export function reportDate(body: string, clock: { date: string; minutes: number }): string {
  const text = normalize(body);
  if (TOMORROW_PATTERN.test(text)) return addDays(clock.date, 1);
  if (TODAY_PATTERN.test(text)) return clock.date;
  return clock.minutes >= timeToMinutes(EVENING_CUTOFF_TIME)
    ? addDays(clock.date, 1)
    : clock.date;
}

/** Children named in the text (by first name), or all of them for "both" / "all" / "kids". */
export function matchChildren(body: string, children: InboundChild[]): InboundChild[] {
  const text = normalize(body);
  const named = children.filter((child) => {
    const first = child.firstName.trim().toLowerCase();
    return first.length > 0 && new RegExp(`\\b${escapeRegExp(first)}\\b`).test(text);
  });
  if (named.length > 0) return named;
  if (children.length > 1 && ALL_CHILDREN_PATTERN.test(text)) return children;
  return [];
}

export function trimReason(body: string): string {
  const text = body.replace(/\s+/g, " ").trim();
  return text.length > MAX_REASON_LENGTH ? `${text.slice(0, MAX_REASON_LENGTH - 1)}…` : text;
}

// ── Planning ─────────────────────────────────────────────────────────────────

export function planInboundSms(input: {
  body: string;
  knownSender: boolean;
  children: InboundChild[];
  clock: { date: string; minutes: number };
  followUp: PendingFollowUp | null;
}): InboundPlan {
  const { body, children, clock, followUp } = input;

  if (isCarrierKeyword(body)) return { kind: "ignored" };
  if (!input.knownSender) return { kind: "forward", why: "unknown_sender" };
  if (children.length === 0) return { kind: "forward", why: "no_children" };

  const isAbsence = looksLikeAbsence(body);

  // Answer to an earlier "which child?" question — unless it's a new absence
  // report of its own (then it's handled fresh below).
  if (followUp && !isAbsence) {
    const answered = matchChildren(body, children);
    const everyone = /^\s*all\s*[.!]?\s*$/i.test(body);
    if (answered.length > 0 || everyone) {
      return {
        kind: "report",
        children: answered.length > 0 ? answered : children,
        date: followUp.date,
        reason: followUp.reason,
        resolvesFollowUpId: followUp.id,
      };
    }
  }

  if (!isAbsence) return { kind: "forward", why: "not_absence" };

  const date = reportDate(body, clock);
  const reason = trimReason(body);
  const named = matchChildren(body, children);
  if (named.length > 0 || children.length === 1) {
    return {
      kind: "report",
      children: named.length > 0 ? named : children,
      date,
      reason,
      resolvesFollowUpId: followUp?.id ?? null,
    };
  }
  return { kind: "ask_child", date, reason, children };
}

// ── Message text ─────────────────────────────────────────────────────────────

export function friendlyDate(date: string): string {
  return new Date(`${date}T12:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function acknowledgementMessage(
  children: InboundChild[],
  date: string,
  today: string,
): string {
  const names = joinNames(children.map((child) => child.firstName));
  const when =
    date === today
      ? `today (${friendlyDate(date)})`
      : date === addDays(today, 1)
        ? `tomorrow (${friendlyDate(date)})`
        : `on ${friendlyDate(date)}`;
  return `Salaam Institute: Thank you — we've noted that ${names} will be absent ${when}. The school will review it.`;
}

export function askWhichChildMessage(children: InboundChild[]): string {
  const names = children.map((child) => child.firstName).join(", ");
  return `Salaam Institute: Thank you for letting us know. Which child will be absent? Reply with a name (${names}) or ALL.`;
}

export function forwardToAdminMessage(input: {
  senderLabel: string;
  body: string;
}): string {
  return `ControlPad: text from ${input.senderLabel}: "${trimReason(input.body)}"`;
}
