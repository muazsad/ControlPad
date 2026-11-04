import { NextResponse, type NextRequest } from "next/server";

import { cronDateParam, cronSchools, requireCronSecret } from "@/app/api/cron/_utils";
import { sendAdminDigest } from "@/lib/alerts/admin-digest";
import { localDate } from "@/lib/schools/clock";
import { forEachSchool } from "@/lib/schools/for-each-school";

export const dynamic = "force-dynamic";

// Runs from attendance-tick at each school's admin_digest_time; kept for
// manual runs (?force=1, ?date=YYYY-MM-DD, ?school=<id>).
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const force = request.nextUrl.searchParams.get("force") === "1";
  const schools = await forEachSchool(await cronSchools(request), async (ctx) => {
    const date = cronDateParam(request, localDate(now, ctx.timeZone));
    const result = await sendAdminDigest(ctx, { date, force, now });
    return {
      date,
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
    };
  });

  return NextResponse.json({ ok: true, force, schools });
}
