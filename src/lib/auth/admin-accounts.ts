import { createServiceClient } from "@/lib/supabase/server";
import type { AppRole } from "@/components/controlpad/user-menu";

type CreateAccountInput = {
  email: string;
  password: string;
  fullName: string;
  role: AppRole;
  phone?: string | null;
};

type CreateAccountResult =
  | { userId: string; error: null }
  | { userId: null; error: string };

/**
 * Creates a Supabase auth user with a password and a matching profile row, using
 * the service-role client (server-only). This is how an admin provisions
 * moderator and parent logins without requiring SMTP-based email invites.
 *
 * Callers MUST verify the current user is an admin before calling this — the
 * service client bypasses RLS.
 */
export async function createAuthUserWithProfile({
  email,
  password,
  fullName,
  role,
  phone = null,
}: CreateAccountInput): Promise<CreateAccountResult> {
  const admin = createServiceClient();

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

  if (createError || !created.user) {
    return {
      userId: null,
      error: createError?.message ?? "Could not create the account.",
    };
  }

  const userId = created.user.id;

  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    role,
    full_name: fullName,
    phone,
  });

  if (profileError) {
    // Roll back the orphaned auth user so the email can be retried cleanly.
    await admin.auth.admin.deleteUser(userId);
    return { userId: null, error: profileError.message };
  }

  return { userId, error: null };
}
