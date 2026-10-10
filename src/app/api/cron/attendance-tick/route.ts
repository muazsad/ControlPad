import { NextResponse, type NextRequest } from "next/server";

import { cronDateParam, requireCronSecret } from "@/app/api/cron/_utils";
import { runAttendanceTick, schoolClock } from "@/lib/alerts/attendance-escalation";

export const dynamic = "force-dynamic";

// Called every 10 minutes by Supabase pg_cron (see
// supabase/migrations/20261010000100_attendance_tick_scheduler.sql).
// Each student's schedule group decides when the admin review text and the
// parent texts go out; repeated calls are deduped.
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const date = cronDateParam(request, schoolClock(now).date);
  const result = await runAttendanceTick({ now, date });

  return NextResponse.json({ ok: true, ...result });
}
