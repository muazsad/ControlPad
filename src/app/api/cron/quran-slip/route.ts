import { NextResponse, type NextRequest } from "next/server";

import { todayInSchoolTimeZone } from "@/lib/alerts/attendance";
import { checkQuranSlipAlerts } from "@/lib/alerts/quran";
import { cronDateParam, requireCronSecret } from "@/app/api/cron/_utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  // Runs from attendance-tick at QURAN_CHECK_TIME; kept for manual runs.
  const date = cronDateParam(request, todayInSchoolTimeZone());
  const result = await checkQuranSlipAlerts(date);

  return NextResponse.json({ ok: true, date, ...result });
}
