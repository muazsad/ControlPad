// Every table whose rows belong to one school. Each must have a not-null
// school_id, RLS enabled, and only policies that check current_school_id().
// Used by tests/tenant-rls.test.mjs and tests/service-role-school-scope.test.mjs.
export const TENANT_TABLES = [
  "students",
  "guardians",
  "student_guardians",
  "courses",
  "grades",
  "attendance",
  "quran_progress",
  "student_memorized_juz",
  "juz_tests",
  "payments",
  "notifications",
  "settings",
  "school_weekly_patterns",
  "school_breaks",
  "school_special_days",
  "schedule_groups",
  "schedule_group_days",
  "inbound_messages",
  "absence_reports",
  "announcements",
  "school_sms_config",
];

// Tables that may only be touched by the service role (RLS on, no policies).
export const SERVICE_ONLY_TABLES = ["school_sms_config", "platform_admins"];
