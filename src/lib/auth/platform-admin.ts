import { notFound, redirect } from "next/navigation";

import { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * The signed-in user must be listed in platform_admins (added by the owner,
 * docs/SETUP.md). Anyone else gets a 404 so the page's existence isn't revealed.
 * A platform admin needn't belong to a school.
 */
export async function requirePlatformAdmin(): Promise<{ userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await createServiceClient()
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) notFound();
  return { userId: user.id };
}
