"use server";

import { redirect } from "next/navigation";

import { createClient, createServiceClient } from "@/lib/supabase/server";

export type SetupProfileState = {
  error: string | null;
};

function text(formData: FormData, key: string) {
  return (formData.get(key) as string | null)?.trim() ?? "";
}

export async function createFirstAdminProfile(
  _prevState: SetupProfileState,
  formData: FormData,
): Promise<SetupProfileState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Sign in before creating the first admin profile." };
  }

  const fullName = text(formData, "full_name");
  if (!fullName) {
    return { error: "Full name is required." };
  }

  const admin = createServiceClient();
  const { count, error: countError } = await admin
    .from("profiles")
    .select("*", { count: "exact", head: true });

  if (countError) {
    return { error: countError.message };
  }

  if ((count ?? 0) > 0) {
    return {
      error: "An admin account already exists. Ask your administrator to assign your role.",
    };
  }

  const { error } = await admin.from("profiles").insert({
    id: user.id,
    role: "admin",
    full_name: fullName,
  });

  if (error) {
    return { error: error.message };
  }

  redirect("/");
}
