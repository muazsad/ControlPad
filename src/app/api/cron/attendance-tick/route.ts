import { NextResponse, type NextRequest } from "next/server";

import { cronDateParam, cronSchools, requireCronSecret } from "@/app/api/cron/_utils";
import { runAttendanceTick } from "@/lib/alerts/attendance-escalation";
import { sendDueAnnouncements } from "@/lib/announcements/send";
import { localDate } from "@/lib/schools/clock";
import { forEachSchool } from "@/lib/schools/for-each-school";

export const dynamic = "force-dynamic";

// Called every 10 minutes, around the clock, by Supabase pg_cron (see
// supabase/migrations/20261103000300_tick_all_day.sql). Runs each school in
// turn on its own local date; one school failing doesn't stop the others.
// Each student's schedule group decides when the admin review text and the
// parent texts go out; repeated calls are deduped. Also sends scheduled
// announcements once their time has passed.
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const schools = await forEachSchool(await cronSchools(request), async (ctx) => {
    const date = cronDateParam(request, localDate(now, ctx.timeZone));
    const attendance = await runAttendanceTick(ctx, { now, date });

    // Scheduled announcements that are due (a fixed instant, so not date-scoped).
    // A failure here must not hide the attendance result.
    let announcements: { sent: number } | { error: string };
    try {
      announcements = await sendDueAnnouncements(ctx, now);
    } catch (error) {
      announcements = { error: error instanceof Error ? error.message : "failed" };
    }
    return { ...attendance, announcements };
  });

  return NextResponse.json({ ok: true, schools });
}
