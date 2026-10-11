"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { InlineError } from "@/components/controlpad/inline-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { updateCourseDates, type GradeActionState } from "../actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="h-10">
      {pending ? "Saving..." : "Save dates"}
    </Button>
  );
}

export function CourseDatesForm({
  courseId,
  startDate,
  endDate,
}: {
  courseId: string;
  startDate: string | null;
  endDate: string | null;
}) {
  const [state, formAction] = useActionState<GradeActionState, FormData>(
    updateCourseDates,
    { error: null },
  );

  useEffect(() => {
    if (state.error) {
      toast.error("Could not save course dates", { description: state.error });
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="course_id" value={courseId} />
      {state.error ? <InlineError message={state.error} /> : null}
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="course_start_date">Course start</Label>
          <Input
            id="course_start_date"
            name="start_date"
            type="date"
            defaultValue={startDate ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="course_end_date">Course end</Label>
          <Input
            id="course_end_date"
            name="end_date"
            type="date"
            defaultValue={endDate ?? ""}
          />
        </div>
        <SubmitButton />
      </div>
      <p className="text-xs text-muted-foreground">
        Leave blank to use the term dates.
      </p>
    </form>
  );
}
