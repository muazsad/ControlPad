import { Settings } from "lucide-react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/controlpad/app-shell";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";

import { SettingsForm } from "./settings-form";
import type { SettingsValues } from "./settings-validation";

type SettingsRow = SettingsValues & {
  updated_at: string;
};

export default async function SettingsPage() {
  const profile = await getCurrentProfile();

  if (profile.role !== "admin") redirect("/");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settings")
    .select(
      "grade_floor, tardy_window_hours, tardies_per_week, quran_inactivity_days, payment_due_day, school_start, admin_digest_time, updated_at",
    )
    .eq("id", 1)
    .single();

  const settings = data as SettingsRow | null;

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          title="Settings"
          description="Tune the thresholds that drive alerts, dashboard warnings, and daily summary timing."
        />

        {error || !settings ? (
          <EmptyState
            title="Could not load settings"
            description={
              error?.message ??
              "The settings row is missing. Check the initial migration seed."
            }
            icon={Settings}
          />
        ) : (
          <SettingsForm settings={settings} />
        )}
      </div>
    </AppShell>
  );
}
