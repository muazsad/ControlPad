import { toE164 } from "@/lib/people/people";
import { isValidTimeZone } from "@/lib/schools/time-zones";

export type CreateSchoolValues = {
  schoolName: string;
  smsName: string;
  timeZone: string;
  fullName: string;
  phone: string | null;
};

export type ParseResult = { ok: true; values: CreateSchoolValues } | { ok: false; error: string };

const text = (data: FormData, key: string) => ((data.get(key) as string | null) ?? "").trim();

export function parseCreateSchool(data: FormData): ParseResult {
  const schoolName = text(data, "school_name");
  const smsName = text(data, "sms_name") || schoolName;
  const timeZone = text(data, "time_zone");
  const fullName = text(data, "full_name");
  const rawPhone = text(data, "phone");

  if (schoolName.length < 2 || schoolName.length > 80) return { ok: false, error: "School name must be 2–80 characters." };
  if (smsName.length < 2 || smsName.length > 40) return { ok: false, error: "Text name must be 2–40 characters." };
  if (!isValidTimeZone(timeZone)) return { ok: false, error: "Pick a time zone." };
  if (!fullName) return { ok: false, error: "Your name is required." };
  const phone = rawPhone ? toE164(rawPhone) : null;
  if (rawPhone && !phone) return { ok: false, error: "Enter a valid US phone number." };

  return { ok: true, values: { schoolName, smsName, timeZone, fullName, phone } };
}
