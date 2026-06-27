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
  studentId: string;
  studentName: string;
  courseName: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="h-10">
      {pending ? "Recording..." : "Record grade"}
    </Button>
  );
}

export function GradeForm({
  courseId,
  studentId,
  studentName,
  courseName,
}: GradeFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const gradeInputId = `grade_value_${courseId}`;
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
      <input type="hidden" name="student_id" value={studentId} />
      <input type="hidden" name="student_name" value={studentName} />
      <input type="hidden" name="course_name" value={courseName} />
      {state.error ? <InlineError message={state.error} /> : null}

      <div className="grid gap-4 sm:grid-cols-[160px_1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor={gradeInputId}>Grade</Label>
          <Input
            id={gradeInputId}
            name="grade_value"
            type="number"
            min="0"
            max="100"
            step="0.1"
            required
            placeholder="0-100"
          />
        </div>
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
    </form>
  );
}
