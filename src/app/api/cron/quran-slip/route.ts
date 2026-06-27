import { NextResponse, type NextRequest } from "next/server";

import { checkQuranSlipAlerts } from "@/lib/alerts/quran";
import { cronDateParam, requireCronSecret } from "@/app/api/cron/_utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const date = cronDateParam(
    request,
    new Date().toISOString().slice(0, 10),
  );
  const result = await checkQuranSlipAlerts(date);

  return NextResponse.json({ ok: true, date, ...result });
}
