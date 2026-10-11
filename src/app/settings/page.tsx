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
import { specialDayRecipients } from "@/lib/alerts/special-day";
import { loadSpecialDayRows, specialDayFromRow } from "@/lib/schedule/calendar-data";
import { getScheduleGroups } from "@/lib/schedule/schedule-groups-data";
import { createClient } from "@/lib/supabase/server";

import { ScheduleForm } from "./schedule-form";
import { ScheduleGroupsForm } from "./schedule-groups-form";
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

type ActiveStudentRow = {
  schedule_group_id: string | null;
  student_guardians:
    | { guardians: { phone: string | null } | { phone: string | null }[] | null }[]
    | null;
};

export default async function SettingsPage() {
  const profile = await getCurrentProfile();

  if (profile.role !== "admin") redirect("/");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settings")
    .select(
      "grade_floor, tardy_window_hours, tardies_per_week, quran_inactivity_days, payment_due_day, school_start, admin_digest_time, parent_alert_delay_minutes, term_start, term_end, pace_gap_threshold, missing_assignments_threshold, updated_at",
    )
    .eq("id", 1)
    .single();

  const settings = data as SettingsRow | null;

  const [
    { data: weeklyPatternData },
    { data: breaksData },
    { data: specialDaysData },
    scheduleGroups,
    { data: activeStudents },
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
    loadSpecialDayRows(supabase),
    getScheduleGroups(),
    supabase
      .from("students")
      .select("schedule_group_id, student_guardians(guardians(phone))")
      .eq("enrollment_status", "active"),
  ]);

  const studentCounts: Record<string, number> = {};
  let ungroupedCount = 0;
  const studentRows = (activeStudents ?? []) as ActiveStudentRow[];
  for (const row of studentRows) {
    if (row.schedule_group_id) {
      studentCounts[row.schedule_group_id] = (studentCounts[row.schedule_group_id] ?? 0) + 1;
    } else {
      ungroupedCount += 1;
    }
  }

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
  const specialDays: SpecialDay[] = (specialDaysData ?? []).map(specialDayFromRow);

  // How many parent phones "Text parents now" would reach, per special day.
  const recipientStudents = studentRows.map((row) => ({
    groupId: row.schedule_group_id,
    guardians: (row.student_guardians ?? []).flatMap((link) =>
      Array.isArray(link.guardians) ? link.guardians : link.guardians ? [link.guardians] : [],
    ),
  }));
  const recipientCounts: Record<string, number> = {};
  for (const day of specialDays) {
    if (day.parentMessage?.trim()) {
      recipientCounts[day.date] = specialDayRecipients(day, recipientStudents).length;
    }
  }

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
            <ScheduleGroupsForm
              groups={scheduleGroups}
              studentCounts={studentCounts}
              ungroupedCount={ungroupedCount}
            />
            <ScheduleForm
              weeklyPattern={weeklyPattern}
              breaks={schoolBreaks}
              specialDays={specialDays}
              groups={scheduleGroups.map((group) => ({ id: group.id, name: group.name }))}
              recipientCounts={recipientCounts}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}
