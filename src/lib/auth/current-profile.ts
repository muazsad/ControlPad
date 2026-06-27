import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/components/controlpad/user-menu";

export type CurrentProfile = {
  id: string;
  fullName: string;
  role: AppRole;
};

const validRoles = new Set<AppRole>(["admin", "moderator", "parent"]);

export async function getCurrentProfile(): Promise<CurrentProfile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/setup-profile");

  const role = profile.role as AppRole;

  if (!validRoles.has(role)) redirect("/setup-profile");

  return {
    id: user.id,
    fullName: profile.full_name,
    role,
  };
}

/**
 * Server-side role gate. Use at the top of any page or action that should only
 * be reachable by specific roles. Redirects unauthorized users home rather than
 * leaking the existence of a page. RLS is still the real enforcement boundary —
 * this is a UX/defense-in-depth layer.
 */
export async function requireRole(
  allowed: AppRole[],
): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();
  if (!allowed.includes(profile.role)) redirect("/");
  return profile;
}
