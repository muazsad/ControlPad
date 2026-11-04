// Client-safe type. Everything server-side code needs to act for one school.
export type SchoolContext = {
  schoolId: string;
  name: string;
  /** Prefix on every text, e.g. "Salaam Institute". */
  smsName: string;
  /** IANA zone; decides the school's local date and alert times. */
  timeZone: string;
};

export type SchoolRow = { id: string; name: string; sms_name: string; time_zone: string };

export function contextFromRow(row: SchoolRow): SchoolContext {
  return { schoolId: row.id, name: row.name, smsName: row.sms_name, timeZone: row.time_zone };
}
