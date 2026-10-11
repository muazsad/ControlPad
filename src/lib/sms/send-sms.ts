import { createServiceClient } from "@/lib/supabase/server";

export type NotificationTrigger =
  | "low_grade"
  | "absence"
  | "tardy_threshold"
  | "quran_slip"
  | "payment_overdue"
  | "admin_digest"
  | "absence_review"
  | "manual_test"
  | "special_day"
  | "absence_report_reply"
  | "parent_message";

export type RecipientType = "admin" | "parent";

export type SendSmsInput = {
  recipientPhone: string;
  recipientType: RecipientType;
  studentId: string | null;
  triggerType: NotificationTrigger;
  body: string;
  dedupeWindowHours?: number;
  /** When set, dedupe on this key (per recipient) instead of student + trigger. */
  dedupeKey?: string | null;
};

/**
 * How texts are handled:
 * - off:  nothing is sent; each message is logged with status "dry_run".
 * - test: every message goes to SMS_TEST_NUMBER instead of the real recipient.
 * - live: messages go to the real recipient.
 */
export type SmsMode = "off" | "test" | "live";

export type SmsConfig = {
  mode: SmsMode;
  /** Why the mode is what it is — shown on the Messages page. */
  reason: string;
  twilio: { accountSid: string; authToken: string; fromPhone: string } | null;
  testNumber: string | null;
};

export type NotificationStatus = "queued" | "sent" | "failed" | "dry_run";

/**
 * After this many failed sends for the same alert (same recipient + student +
 * trigger, or same dedupe key) within the dedupe window, stop retrying. Stops a
 * number Twilio keeps rejecting from being retried on every 10-minute tick.
 */
export const MAX_FAILED_SEND_ATTEMPTS = 3;

/** Most recent matching rows read for a dedupe decision. */
export const DEDUPE_LOOKBACK_ROW_LIMIT = 20;

export type RecentNotification = {
  id: string;
  status: NotificationStatus;
  /** null for rows logged before delivery modes existed. */
  delivery_mode: SmsMode | null;
};

export type DedupeDecision =
  | { action: "send" }
  | { action: "duplicate"; notification: RecentNotification }
  | { action: "gave_up"; failedAttempts: number };

/**
 * Decides whether an alert should go out, given the recent notifications for
 * the same recipient + student + trigger (or dedupe key) within the window.
 *
 * - A message that reached someone (sent) or is in flight (queued) blocks a
 *   repeat — but only if it was sent in the current mode, so test-mode texts
 *   don't block real alerts once texting goes live.
 * - Dry runs never reached anyone, so they don't block a real send. While
 *   texting is off they do block another dry run, so the 10-minute tick
 *   doesn't flood /messages.
 * - Failed sends don't block a retry until MAX_FAILED_SEND_ATTEMPTS is reached.
 *
 * Rows with no delivery_mode (logged before modes existed) count for any mode.
 */
export function decideDedupe(
  recent: readonly RecentNotification[],
  mode: SmsMode,
): DedupeDecision {
  const sameMode = (row: RecentNotification) =>
    row.delivery_mode === null || row.delivery_mode === mode;

  const blocking = recent.find((row) => {
    if (row.status === "sent" || row.status === "queued") {
      return mode === "off" || sameMode(row);
    }
    if (row.status === "dry_run") return mode === "off";
    return false;
  });
  if (blocking) return { action: "duplicate", notification: blocking };

  if (mode !== "off") {
    const failedAttempts = recent.filter(
      (row) => row.status === "failed" && sameMode(row),
    ).length;
    if (failedAttempts >= MAX_FAILED_SEND_ATTEMPTS) {
      return { action: "gave_up", failedAttempts };
    }
  }

  return { action: "send" };
}

export type SmsResult =
  | { status: "duplicate"; notification: unknown }
  | { status: "gave_up"; notification: null; error: string }
  | { status: "queued"; notification: unknown }
  | { status: "dry_run"; notification: unknown }
  | { status: "sent"; notification: unknown }
  | { status: "failed"; notification: unknown; error: string };

export type SmsDatabase = {
  /** Matching notifications created since `since`, newest first. */
  findRecentNotifications(input: {
    recipientPhone: string;
    studentId: string | null;
    triggerType: NotificationTrigger;
    since: Date;
    dedupeKey?: string | null;
  }): Promise<RecentNotification[]>;
  insertNotification(row: {
    recipient_phone: string;
    recipient_type: RecipientType;
    student_id: string | null;
    trigger_type: NotificationTrigger;
    body: string;
    status: NotificationStatus;
    dedupe_key?: string | null;
    delivery_mode?: SmsMode;
    twilio_sid?: string | null;
    error?: string | null;
    sent_at?: string | null;
  }): Promise<unknown>;
  updateNotification(
    id: string,
    patch: {
      status: "sent" | "failed";
      twilio_sid?: string | null;
      error?: string | null;
      sent_at?: string | null;
    },
  ): Promise<unknown>;
};

type SendSmsDeps = {
  database?: SmsDatabase;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => Date;
};

function getNotificationId(notification: unknown): string | null {
  if (
    notification &&
    typeof notification === "object" &&
    "id" in notification &&
    typeof notification.id === "string"
  ) {
    return notification.id;
  }
  return null;
}

function requiredTwilioEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const fromPhone = env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromPhone) return null;

  return { accountSid, authToken, fromPhone };
}

/** Reads SMS_MODE / Twilio / SMS_TEST_NUMBER env vars. Never returns secrets to the client. */
export function getSmsConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): SmsConfig {
  const twilio = requiredTwilioEnv(env);
  const testNumber = env.SMS_TEST_NUMBER?.trim() || null;
  const requested = env.SMS_MODE?.trim().toLowerCase();

  if (requested === "off") {
    return { mode: "off", reason: "SMS_MODE is off.", twilio, testNumber };
  }
  if (!twilio) {
    return {
      mode: "off",
      reason: "Twilio is not configured yet (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER).",
      twilio: null,
      testNumber,
    };
  }
  if (requested === "test") {
    if (!testNumber) {
      return {
        mode: "off",
        reason: "SMS_MODE is test but SMS_TEST_NUMBER is not set.",
        twilio,
        testNumber: null,
      };
    }
    return { mode: "test", reason: "SMS_MODE is test.", twilio, testNumber };
  }
  if (requested && requested !== "live") {
    return {
      mode: "off",
      reason: `Unknown SMS_MODE "${requested}" (use off, test, or live).`,
      twilio,
      testNumber,
    };
  }
  return { mode: "live", reason: "Twilio is configured.", twilio, testNumber };
}

/** "+14135550101" → "•••0101" — avoid showing full numbers in logs/UI. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `•••${digits.slice(-4)}` : "•••";
}

export function createSupabaseSmsDatabase(): SmsDatabase {
  const supabase = createServiceClient();

  return {
    async findRecentNotifications({
      recipientPhone,
      studentId,
      triggerType,
      since,
      dedupeKey,
    }) {
      let query = supabase
        .from("notifications")
        .select("id, status, delivery_mode")
        .eq("recipient_phone", recipientPhone)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(DEDUPE_LOOKBACK_ROW_LIMIT);

      if (dedupeKey) {
        query = query.eq("dedupe_key", dedupeKey);
      } else {
        query = query.eq("trigger_type", triggerType);
        query =
          studentId === null
            ? query.is("student_id", null)
            : query.eq("student_id", studentId);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as RecentNotification[];
    },
    async insertNotification(row) {
      const { data, error } = await supabase
        .from("notifications")
        .insert(row)
        .select("id, status, twilio_sid, error")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    async updateNotification(id, patch) {
      const { data, error } = await supabase
        .from("notifications")
        .update(patch)
        .eq("id", id)
        .select("id, status, twilio_sid, error")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  };
}

export async function sendSms(
  input: SendSmsInput,
  deps: SendSmsDeps = {},
): Promise<SmsResult> {
  const database = deps.database ?? createSupabaseSmsDatabase();
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const fetchImpl = deps.fetch ?? fetch;
  const dedupeWindowHours = input.dedupeWindowHours ?? 24 * 7;
  const since = new Date(now().getTime() - dedupeWindowHours * 60 * 60 * 1000);
  const config = getSmsConfig(env);

  const recent = await database.findRecentNotifications({
    recipientPhone: input.recipientPhone,
    studentId: input.studentId,
    triggerType: input.triggerType,
    since,
    dedupeKey: input.dedupeKey ?? null,
  });
  const decision = decideDedupe(recent, config.mode);

  if (decision.action === "duplicate") {
    return { status: "duplicate", notification: decision.notification };
  }
  if (decision.action === "gave_up") {
    return {
      status: "gave_up",
      notification: null,
      error: `Not retried: ${decision.failedAttempts} failed attempts in the dedupe window.`,
    };
  }

  const twilioEnv = config.mode === "off" ? null : config.twilio;

  const notification = await database.insertNotification({
    recipient_phone: input.recipientPhone,
    recipient_type: input.recipientType,
    student_id: input.studentId,
    trigger_type: input.triggerType,
    body: input.body,
    status: twilioEnv ? "queued" : "dry_run",
    dedupe_key: input.dedupeKey ?? null,
    delivery_mode: config.mode,
    error: twilioEnv ? null : `Not sent: ${config.reason}`,
  });

  if (!twilioEnv) {
    return { status: "dry_run", notification };
  }

  const toPhone =
    config.mode === "test" && config.testNumber
      ? config.testNumber
      : input.recipientPhone;
  const outgoingBody =
    config.mode === "test"
      ? `[TEST to ${input.recipientType} ${maskPhone(input.recipientPhone)}] ${input.body}`
      : input.body;

  const notificationId = getNotificationId(notification);
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioEnv.accountSid}/Messages.json`;
  const auth = Buffer.from(
    `${twilioEnv.accountSid}:${twilioEnv.authToken}`,
  ).toString("base64");

  try {
    const response = await fetchImpl(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: toPhone,
        From: twilioEnv.fromPhone,
        Body: outgoingBody,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      sid?: string;
      message?: string;
    };

    if (!response.ok) {
      const message =
        payload.message ?? `Twilio request failed with ${response.status}`;
      if (notificationId) {
        const updated = await database.updateNotification(notificationId, {
          status: "failed",
          error: message,
        });
        return { status: "failed", notification: updated, error: message };
      }
      return { status: "failed", notification, error: message };
    }

    if (notificationId) {
      const updated = await database.updateNotification(notificationId, {
        status: "sent",
        twilio_sid: payload.sid ?? null,
        error: null,
        sent_at: now().toISOString(),
      });
      return { status: "sent", notification: updated };
    }

    return { status: "sent", notification };
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMS send failed.";
    if (notificationId) {
      const updated = await database.updateNotification(notificationId, {
        status: "failed",
        error: message,
      });
      return { status: "failed", notification: updated, error: message };
    }
    return { status: "failed", notification, error: message };
  }
}
