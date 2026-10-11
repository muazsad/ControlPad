"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { reviewAbsenceReport, type AttendanceActionState } from "@/app/attendance/actions";
import { Button } from "@/components/ui/button";

const initialState: AttendanceActionState = { error: null };

export function AbsenceReportReview({ reportId }: { reportId: string }) {
  const [state, action, pending] = useActionState(reviewAbsenceReport, initialState);

  useEffect(() => {
    if (state.error) toast.error("Could not save", { description: state.error });
  }, [state]);

  return (
    <form action={action} >
      <input type="hidden" name="report_id" value={reportId} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="excused" size="sm" disabled={pending}>
          Excuse
        </Button>
        <Button type="submit" name="decision" value="unexcused" size="sm" variant="outline" disabled={pending}>
          Unexcused absence
        </Button>
        <Button type="submit" name="decision" value="dismissed" size="sm" variant="ghost" disabled={pending}>
          Dismiss
        </Button>
      </div>
    </form>
  );
}
