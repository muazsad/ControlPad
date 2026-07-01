import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isMissingSchoolCalendarTableError } from "./calendar-data";

describe("school calendar data loading", () => {
  it("recognizes missing schedule tables as a safe default-calendar fallback", () => {
    assert.equal(
      isMissingSchoolCalendarTableError({
        message:
          "Could not find the table 'public.school_weekly_patterns' in the schema cache",
      }),
      true,
    );
  });

  it("does not hide unrelated Supabase errors", () => {
    assert.equal(
      isMissingSchoolCalendarTableError({
        message: "permission denied for table school_weekly_patterns",
      }),
      false,
    );
  });
});
