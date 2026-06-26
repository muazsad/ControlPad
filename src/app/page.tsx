import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SignOutButton from "./sign-out-button";

export default async function HomePage() {
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

  const roleLabel: Record<string, string> = {
    admin: "Administrator",
    moderator: "Moderator",
    parent: "Parent",
  };

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">ControlPad</h1>
          <p className="text-xs text-gray-500">Salaam Institute</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm">
            {profile.full_name}{" "}
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              {roleLabel[profile.role] ?? profile.role}
            </span>
          </span>
          <SignOutButton />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-semibold">
            Welcome, {profile.full_name}
          </h2>
          <p className="text-gray-500">
            You are signed in as{" "}
            <strong>{roleLabel[profile.role] ?? profile.role}</strong>.
          </p>
          <p className="text-sm text-gray-400">
            More features coming in the next phase.
          </p>
        </div>
      </main>
    </div>
  );
}
