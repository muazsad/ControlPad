import { NextResponse, type NextRequest } from "next/server";

import { cronDateParam, requireCronSecret } from "@/app/api/cron/_utils";
import { runAttendanceTick, schoolClock } from "@/lib/alerts/attendance-escalation";
import { sendDueAnnouncements } from "@/lib/announcements/send";

export const dynamic = "force-dynamic";

// Called every 10 minutes by Supabase pg_cron (see
// supabase/migrations/20261010000100_attendance_tick_scheduler.sql).
// Each student's schedule group decides when the admin review text and the
// parent texts go out; repeated calls are deduped. Also sends scheduled
// announcements once their time has passed.
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const date = cronDateParam(request, schoolClock(now).date);
  const result = await runAttendanceTick({ now, date });

  // Scheduled announcements that are due (a fixed instant, so not date-scoped).
  // A failure here must not hide the attendance result.
  let announcements: { sent: number } | { error: string };
  try {
    announcements = await sendDueAnnouncements(now);
  } catch (error) {
    announcements = { error: error instanceof Error ? error.message : "failed" };
  }

  return NextResponse.json({ ok: true, ...result, announcements });
}
