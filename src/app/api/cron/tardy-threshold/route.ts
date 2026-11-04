import { NextResponse, type NextRequest } from "next/server";

import { cronDateParam, cronSchools, requireCronSecret } from "@/app/api/cron/_utils";
import { checkTardyThresholdAlerts } from "@/lib/alerts/attendance";
import { localDate } from "@/lib/schools/clock";
import { forEachSchool } from "@/lib/schools/for-each-school";

export const dynamic = "force-dynamic";

// Runs from attendance-tick after the day's last parent-alert time; kept for manual runs.
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const schools = await forEachSchool(await cronSchools(request), async (ctx) => {
    const date = cronDateParam(request, localDate(now, ctx.timeZone));
    return { date, ...(await checkTardyThresholdAlerts(ctx, { date })) };
  });

  return NextResponse.json({ ok: true, schools });
}
