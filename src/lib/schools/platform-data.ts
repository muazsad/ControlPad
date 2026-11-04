import type { SmsMode } from "@/lib/sms/send-sms";
import { createServiceClient } from "@/lib/supabase/server";

// The platform admin's overview of every school (counts only, never student,
// guardian or message data). Service role, so callers must have passed
// requirePlatformAdmin() first.

export type PlatformSchool = {
  id: string;
  name: string;
  createdAt: string;
  staff: number;
  students: number;
  textingVerified: boolean;
  requestedMode: SmsMode;
  liveApproved: boolean;
};

function countBy(rows: { school_id: string }[] | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows ?? []) counts.set(row.school_id, (counts.get(row.school_id) ?? 0) + 1);
  return counts;
}

export async function listPlatformSchools(): Promise<PlatformSchool[]> {
  const db = createServiceClient();
  const [schools, configs, staff, students] = await Promise.all([
    db.from("schools").select("id, name, created_at").eq("archived", false).order("created_at"),
    // tenant-scope-ok: platform admin overview across schools, texting state only
    db.from("school_sms_config").select("school_id, verified_at, requested_mode, live_approved_at"),
    // tenant-scope-ok: platform admin overview, counts only
    db.from("profiles").select("school_id").in("role", ["admin", "moderator"]),
    // tenant-scope-ok: platform admin overview, counts only
    db.from("students").select("school_id").eq("enrollment_status", "active"),
  ]);
  for (const result of [schools, configs, staff, students]) {
    if (result.error) throw new Error(result.error.message);
  }

  const configBySchool = new Map(
    (configs.data ?? []).map((row) => [row.school_id as string, row]),
  );
  const staffCounts = countBy(staff.data as { school_id: string }[] | null);
  const studentCounts = countBy(students.data as { school_id: string }[] | null);

  return (schools.data ?? []).map((row) => {
    const config = configBySchool.get(row.id as string);
    return {
      id: row.id as string,
      name: row.name as string,
      createdAt: row.created_at as string,
      staff: staffCounts.get(row.id as string) ?? 0,
      students: studentCounts.get(row.id as string) ?? 0,
      textingVerified: Boolean(config?.verified_at),
      requestedMode: ((config?.requested_mode as SmsMode | undefined) ?? "off"),
      liveApproved: Boolean(config?.live_approved_at),
    };
  });
}

export async function setLiveApprovalFor(
  schoolId: string,
  approvedBy: string | null,
): Promise<string | null> {
  const now = new Date().toISOString();
  const { error } = await createServiceClient()
    .from("school_sms_config")
    .update({
      live_approved_at: approvedBy ? now : null,
      live_approved_by: approvedBy,
      updated_at: now,
    })
    .eq("school_id", schoolId);
  return error?.message ?? null;
}
