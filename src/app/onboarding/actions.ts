"use server";

import { redirect } from "next/navigation";

import { parseCreateSchool } from "@/lib/schools/onboarding-validation";
import { createClient } from "@/lib/supabase/server";

export type CreateSchoolState = { error: string | null };

export async function createSchool(_prev: CreateSchoolState, formData: FormData): Promise<CreateSchoolState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = parseCreateSchool(formData);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.values;

  // create_school() runs as the signed-in user (auth.uid()); it refuses if the
  // user already belongs to a school.
  const { error } = await supabase.rpc("create_school", {
    p_name: v.schoolName,
    p_sms_name: v.smsName,
    p_time_zone: v.timeZone,
    p_full_name: v.fullName,
    p_phone: v.phone ?? "",
  });
  if (error) return { error: error.message };

  redirect("/");
}
