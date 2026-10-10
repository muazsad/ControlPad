import { NextResponse, type NextRequest } from "next/server";

import { cronDateParam, requireCronSecret } from "@/app/api/cron/_utils";
import { schoolClock } from "@/lib/alerts/attendance-escalation";
import { checkPaymentOverdueAlerts } from "@/lib/alerts/payment";

export const dynamic = "force-dynamic";

// Daily (Vercel Cron). Texts parents + admin once settings.payment_due_day has
// passed for the month; sendSms dedupes so each student is texted at most weekly.
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const date = cronDateParam(request, schoolClock(new Date()).date);
  const result = await checkPaymentOverdueAlerts(date);

  return NextResponse.json({ ok: true, date, ...result });
}
