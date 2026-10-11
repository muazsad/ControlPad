"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { InlineError } from "@/components/controlpad/inline-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { recordGrade, type GradeActionState } from "./actions";

type GradeFormProps = {
  courseId: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="h-10">
      {pending ? "Recording..." : "Record grade"}
    </Button>
  );
}

export function GradeForm({ courseId }: GradeFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const gradeInputId = `grade_value_${courseId}`;
  const percentInputId = `percent_complete_${courseId}`;
  const missingInputId = `missing_assignments_${courseId}`;
  const noteInputId = `note_${courseId}`;
  const [state, formAction] = useActionState<GradeActionState, FormData>(
    recordGrade,
    { error: null },
  );

  useEffect(() => {
    if (state.error) {
      toast.error("Could not record grade", { description: state.error });
      return;
    }
    formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <input type="hidden" name="course_id" value={courseId} />
      {state.error ? <InlineError message={state.error} /> : null}

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2">
          <Label htmlFor={gradeInputId}>Grade</Label>
          <Input
            id={gradeInputId}
            name="grade_value"
            type="number"
            min="0"
            max="100"
            step="0.1"
            placeholder="0-100"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={percentInputId}>% complete</Label>
          <Input
            id={percentInputId}
            name="percent_complete"
            type="number"
            min="0"
            max="100"
            step="0.1"
            placeholder="0-100"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={missingInputId}>Missing</Label>
          <Input
            id={missingInputId}
            name="missing_assignments"
            type="number"
            min="0"
            max="999"
            step="1"
            placeholder="0"
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor={noteInputId}>Note</Label>
          <Input
            id={noteInputId}
            name="note"
            placeholder="Optional context from GCVS"
          />
        </div>
        <SubmitButton />
      </div>
      <p className="text-xs text-muted-foreground">
        Leave a box blank to keep its last value.
      </p>
    </form>
  );
}
