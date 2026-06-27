import { createServiceClient } from "@/lib/supabase/server";

export type NotificationTrigger =
  | "low_grade"
  | "absence"
  | "tardy_threshold"
  | "quran_slip"
  | "payment_overdue"
  | "admin_digest";

export type RecipientType = "admin" | "parent";

export type SendSmsInput = {
  recipientPhone: string;
  recipientType: RecipientType;
  studentId: string | null;
  triggerType: NotificationTrigger;
  body: string;
  dedupeWindowHours?: number;
};

export type SmsResult =
  | { status: "duplicate"; notification: unknown }
  | { status: "queued"; notification: unknown }
  | { status: "sent"; notification: unknown }
  | { status: "failed"; notification: unknown; error: string };

export type SmsDatabase = {
  findRecentNotification(input: {
    recipientPhone: string;
    studentId: string | null;
    triggerType: NotificationTrigger;
    since: Date;
  }): Promise<unknown | null>;
  insertNotification(row: {
    recipient_phone: string;
    recipient_type: RecipientType;
    student_id: string | null;
    trigger_type: NotificationTrigger;
    body: string;
    status: "queued" | "sent" | "failed";
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

export function createSupabaseSmsDatabase(): SmsDatabase {
  const supabase = createServiceClient();

  return {
    async findRecentNotification({ recipientPhone, studentId, triggerType, since }) {
      let query = supabase
        .from("notifications")
        .select("id, created_at")
        .eq("recipient_phone", recipientPhone)
        .eq("trigger_type", triggerType)
        .gte("created_at", since.toISOString())
        .limit(1);

      query =
        studentId === null
          ? query.is("student_id", null)
          : query.eq("student_id", studentId);

      const { data, error } = await query.maybeSingle();
      if (error) throw new Error(error.message);
      return data;
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

  const duplicate = await database.findRecentNotification({
    recipientPhone: input.recipientPhone,
    studentId: input.studentId,
    triggerType: input.triggerType,
    since,
  });

  if (duplicate) {
    return { status: "duplicate", notification: duplicate };
  }

  const twilioEnv = requiredTwilioEnv(env);

  const notification = await database.insertNotification({
    recipient_phone: input.recipientPhone,
    recipient_type: input.recipientType,
    student_id: input.studentId,
    trigger_type: input.triggerType,
    body: input.body,
    status: "queued",
    error: twilioEnv
      ? null
      : "SMS dry run: Twilio environment variables are not configured.",
  });

  if (!twilioEnv) {
    return { status: "queued", notification };
  }

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
        To: input.recipientPhone,
        From: twilioEnv.fromPhone,
        Body: input.body,
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
