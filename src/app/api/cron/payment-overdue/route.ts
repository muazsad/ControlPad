import { NextResponse, type NextRequest } from "next/server";

import { cronDateParam, cronSchools, requireCronSecret } from "@/app/api/cron/_utils";
import { checkPaymentOverdueAlerts } from "@/lib/alerts/payment";
import { localDate } from "@/lib/schools/clock";
import { forEachSchool } from "@/lib/schools/for-each-school";

export const dynamic = "force-dynamic";

// Daily (Vercel Cron), per school. Texts parents + admin once that school's
// settings.payment_due_day has passed for the month; sendSms dedupes so each
// student is texted at most weekly.
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const schools = await forEachSchool(await cronSchools(request), async (ctx) => {
    const date = cronDateParam(request, localDate(now, ctx.timeZone));
    return { date, ...(await checkPaymentOverdueAlerts(ctx, date)) };
  });

  return NextResponse.json({ ok: true, schools });
}
