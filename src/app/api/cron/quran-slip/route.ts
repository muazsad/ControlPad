import { NextResponse, type NextRequest } from "next/server";

import { cronDateParam, cronSchools, requireCronSecret } from "@/app/api/cron/_utils";
import { checkQuranSlipAlerts } from "@/lib/alerts/quran";
import { localDate } from "@/lib/schools/clock";
import { forEachSchool } from "@/lib/schools/for-each-school";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  // Runs from attendance-tick at QURAN_CHECK_TIME; kept for manual runs.
  const now = new Date();
  const schools = await forEachSchool(await cronSchools(request), async (ctx) => {
    const date = cronDateParam(request, localDate(now, ctx.timeZone));
    return { date, ...(await checkQuranSlipAlerts(ctx, date)) };
  });

  return NextResponse.json({ ok: true, schools });
}
