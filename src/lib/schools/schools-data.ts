// Service-role loaders for crons and webhooks (no signed-in user).
import { contextFromRow, type SchoolContext, type SchoolRow } from "@/lib/schools/school-context";
import { createServiceClient } from "@/lib/supabase/server";

const COLUMNS = "id, name, sms_name, time_zone";

export async function loadSchoolContext(schoolId: string): Promise<SchoolContext | null> {
  const { data, error } = await createServiceClient()
    .from("schools")
    .select(COLUMNS)
    .eq("id", schoolId)
    .eq("archived", false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? contextFromRow(data as SchoolRow) : null;
}

/** Every non-archived school, oldest first. */
export async function listActiveSchools(): Promise<SchoolContext[]> {
  const { data, error } = await createServiceClient()
    .from("schools")
    .select(COLUMNS)
    .eq("archived", false)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SchoolRow[]).map(contextFromRow);
}
