import { NextResponse, type NextRequest } from "next/server";

import {
  checkAbsenceAlerts,
  todayInSchoolTimeZone,
} from "@/lib/alerts/attendance";
import { cronDateParam, requireCronSecret } from "@/app/api/cron/_utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const date = cronDateParam(request, todayInSchoolTimeZone());
  const result = await checkAbsenceAlerts({ date });

  return NextResponse.json({ ok: true, date, ...result });
}
