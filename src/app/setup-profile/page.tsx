"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Role = "admin" | "moderator" | "parent";

export default function SetupProfilePage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("admin");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    async function check() {
      const supabase = createClient();
      const { count } = await supabase
        .from("profiles")
        .select("*", { count: "exact", head: true });
      setAllowed(count === 0);
    }
    check();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Not authenticated.");
      setLoading(false);
      return;
    }

    const { error: insertError } = await supabase.from("profiles").insert({
      id: user.id,
      role,
      full_name: fullName,
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  if (allowed === null) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex min-h-full items-center justify-center px-4">
        <div className="text-center space-y-2">
          <h1 className="text-xl font-bold">Setup unavailable</h1>
          <p className="text-sm text-gray-500">
            An admin account already exists. Ask your administrator to assign
            your role.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome to ControlPad</h1>
          <p className="mt-1 text-sm text-gray-500">
            Set up the first admin account
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="fullName" className="block text-sm font-medium">
              Full name
            </label>
            <input
              id="fullName"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="role" className="block text-sm font-medium">
              Role
            </label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="admin">Admin</option>
              <option value="moderator">Moderator</option>
              <option value="parent">Parent</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Creating…" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
