import { NextResponse, type NextRequest } from "next/server";

export function requireCronSecret(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured." },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (bearer !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}

export function cronDateParam(request: NextRequest, fallback: string) {
  const date = request.nextUrl.searchParams.get("date");
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : fallback;
}
