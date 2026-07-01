import { Settings } from "lucide-react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/controlpad/app-shell";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import {
  DEFAULT_WEEKLY_PATTERN,
  type SchoolBreak,
  type SpecialDay,
  type WeeklyPattern,
} from "@/lib/schedule/calendar";
import { createClient } from "@/lib/supabase/server";

import { ScheduleForm } from "./schedule-form";
import { SettingsForm } from "./settings-form";
import type { SettingsValues } from "./settings-validation";

type SettingsRow = SettingsValues & {
  updated_at: string;
};

type WeeklyPatternRow = WeeklyPattern & {
  updated_at: string;
};

type SchoolBreakRow = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
};

type SpecialDayRow = {
  date: string;
  type: "no_school" | "half_day";
  start_time: string | null;
  end_time: string | null;
  note: string | null;
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

  const [
    { data: weeklyPatternData },
    { data: breaksData },
    { data: specialDaysData },
  ] = await Promise.all([
    supabase
      .from("school_weekly_patterns")
      .select("sunday, monday, tuesday, wednesday, thursday, friday, saturday, updated_at")
      .eq("id", 1)
      .maybeSingle(),
    supabase
      .from("school_breaks")
      .select("id, name, start_date, end_date")
      .order("start_date", { ascending: true }),
    supabase
      .from("school_special_days")
      .select("date, type, start_time, end_time, note")
      .order("date", { ascending: true }),
  ]);

  const weeklyPattern =
    (weeklyPatternData as WeeklyPatternRow | null) ?? DEFAULT_WEEKLY_PATTERN;
  const schoolBreaks = ((breaksData as SchoolBreakRow[] | null) ?? []).map(
    (schoolBreak): SchoolBreak => ({
      id: schoolBreak.id,
      name: schoolBreak.name,
      startDate: schoolBreak.start_date,
      endDate: schoolBreak.end_date,
    }),
  );
  const specialDays = ((specialDaysData as SpecialDayRow[] | null) ?? []).map(
    (specialDay): SpecialDay => ({
      date: specialDay.date,
      type: specialDay.type,
      startTime: specialDay.start_time,
      endTime: specialDay.end_time,
      note: specialDay.note,
    }),
  );

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          title="Settings"
          description="Tune thresholds and the school schedule that operations should follow."
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
          <div className="space-y-8">
            <SettingsForm settings={settings} />
            <ScheduleForm
              weeklyPattern={weeklyPattern}
              breaks={schoolBreaks}
              specialDays={specialDays}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}
