import { NextResponse, type NextRequest } from "next/server";

import { cronDateParam, requireCronSecret } from "@/app/api/cron/_utils";
import {
  sendAdminDigest,
  todayInSchoolTimeZone,
} from "@/lib/alerts/admin-digest";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const date = cronDateParam(request, todayInSchoolTimeZone());
  const force = request.nextUrl.searchParams.get("force") === "1";
  const result = await sendAdminDigest({
    date,
    force,
    now: new Date(),
  });

  return NextResponse.json({
    ok: true,
    date,
    force,
    sent: result.sent,
    skippedReason: result.skippedReason ?? null,
    recipients: result.recipients,
    counts: {
      absences: result.summary.absences.length,
      tardies: result.summary.tardies.length,
      lowGrades: result.summary.lowGrades.length,
      droppingGrades: result.summary.droppingGrades.length,
      quranSlippage: result.summary.quranSlippage.length,
      overduePayments: result.summary.overduePayments.length,
    },
  });
}
