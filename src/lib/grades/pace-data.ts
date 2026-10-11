import {
  DEFAULT_MISSING_ASSIGNMENTS_THRESHOLD,
  DEFAULT_PACE_GAP_THRESHOLD,
  type PaceContext,
} from "@/lib/grades/pace";
import {
  getSchoolCalendar,
  getServiceSchoolCalendar,
} from "@/lib/schedule/calendar-data";
import {
  getScheduleGroups,
  getServiceScheduleGroups,
} from "@/lib/schedule/schedule-groups-data";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * Loads term dates, pace thresholds, the school calendar and schedule groups
 * once, so any number of courses can be evaluated with `paceForCourse()`.
 * `service: true` is for server-side alerts/digests that run without a user
 * session; pages use the signed-in client (RLS applies).
 */
export async function loadPaceContext(
  options: { service?: boolean } = {},
): Promise<PaceContext> {
  const supabase = options.service ? createServiceClient() : await createClient();

  const [settingsResult, calendar, groups] = await Promise.all([
    supabase
      .from("settings")
      .select(
        "term_start, term_end, pace_gap_threshold, missing_assignments_threshold, school_start, tardy_window_hours",
      )
      .eq("id", 1)
      .single(),
    options.service ? getServiceSchoolCalendar() : getSchoolCalendar(),
    options.service ? getServiceScheduleGroups() : getScheduleGroups(),
  ]);

  if (settingsResult.error) throw new Error(settingsResult.error.message);
  const row = settingsResult.data;

  return {
    term: {
      termStart: row.term_start ?? null,
      termEnd: row.term_end ?? null,
    },
    paceGapThreshold: Number(row.pace_gap_threshold ?? DEFAULT_PACE_GAP_THRESHOLD),
    missingAssignmentsThreshold: Number(
      row.missing_assignments_threshold ?? DEFAULT_MISSING_ASSIGNMENTS_THRESHOLD,
    ),
    calendar,
    groups: new Map(groups.map((group) => [group.id, group])),
    defaults: {
      schoolStart: String(row.school_start).slice(0, 5),
      tardyWindowHours: Number(row.tardy_window_hours),
    },
  };
}
