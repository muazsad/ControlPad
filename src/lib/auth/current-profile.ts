import { redirect } from "next/navigation";

import type { AppRole } from "@/components/controlpad/user-menu";
import type { SchoolContext } from "@/lib/schools/school-context";
import { createClient } from "@/lib/supabase/server";

export type CurrentProfile = {
  id: string;
  fullName: string;
  role: AppRole;
  schoolId: string;
  schoolName: string;
  smsName: string;
  timeZone: string;
};

const validRoles = new Set<AppRole>(["admin", "moderator", "parent"]);

type ProfileRow = {
  full_name: string;
  role: string;
  school_id: string | null;
  schools: { id: string; name: string; sms_name: string; time_zone: string; archived: boolean } | null;
};

export async function getCurrentProfile(): Promise<CurrentProfile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // profiles_own_read lets a user read their own row; schools_member_read lets
  // them read their school only while it isn't archived.
  const { data } = await supabase
    .from("profiles")
    .select("full_name, role, school_id, schools(id, name, sms_name, time_zone, archived)")
    .eq("id", user.id)
    .maybeSingle();

  const profile = data as ProfileRow | null;
  const school = profile?.schools;
  // No profile, no school, or an archived school → create a school first.
  if (!profile || !school || school.archived) redirect("/onboarding");

  const role = profile.role as AppRole;
  if (!validRoles.has(role)) redirect("/onboarding");

  return {
    id: user.id,
    fullName: profile.full_name,
    role,
    schoolId: school.id,
    schoolName: school.name,
    smsName: school.sms_name,
    timeZone: school.time_zone,
  };
}

/** The SchoolContext for server code acting on behalf of the signed-in user. */
export function schoolContextOf(profile: CurrentProfile): SchoolContext {
  return {
    schoolId: profile.schoolId,
    name: profile.schoolName,
    smsName: profile.smsName,
    timeZone: profile.timeZone,
  };
}

/**
 * Server-side role gate. Use at the top of any page or action that should only
 * be reachable by specific roles. The role is the user's role in their school.
 * RLS is still the real enforcement boundary; this is a UX/defense-in-depth layer.
 */
export async function requireRole(allowed: AppRole[]): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();
  if (!allowed.includes(profile.role)) redirect("/");
  return profile;
}
