"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { InlineError } from "@/components/controlpad/inline-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { studentName, type Student } from "@/lib/people/people";

import { createCourse, type GradeActionState } from "./actions";

type CourseFormProps = {
  students: Student[];
  fixedStudentId?: string;
  redirectTo?: string;
  compact?: boolean;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="h-10">
      {pending ? "Adding..." : "Add course"}
    </Button>
  );
}

export function CourseForm({
  students,
  fixedStudentId,
  redirectTo,
  compact = false,
}: CourseFormProps) {
  const [state, formAction] = useActionState<GradeActionState, FormData>(
    createCourse,
    { error: null },
  );
  const [studentId, setStudentId] = useState(fixedStudentId ?? "");

  useEffect(() => {
    if (state.error) {
      toast.error("Could not add course", { description: state.error });
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      {fixedStudentId ? (
        <input type="hidden" name="fixed_student_id" value={fixedStudentId} />
      ) : null}
      {redirectTo ? (
        <input type="hidden" name="redirect_to" value={redirectTo} />
      ) : null}
      {state.error ? <InlineError message={state.error} /> : null}

      <div
        className={
          fixedStudentId ? "grid gap-4" : "grid gap-4 sm:grid-cols-2"
        }
      >
        {fixedStudentId ? null : (
          <div className="space-y-2">
            <Label htmlFor="student_id">Student</Label>
            <input type="hidden" name="student_id" value={studentId} />
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger id="student_id" className="h-10 w-full">
                <SelectValue placeholder="Select student" />
              </SelectTrigger>
              <SelectContent>
                {students.map((student) => (
                  <SelectItem key={student.id} value={student.id}>
                    {studentName(student)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="name">Course name</Label>
          <Input id="name" name="name" required placeholder="Algebra I" />
        </div>
      </div>

      <div
        className={
          compact
            ? "grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
            : "grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
        }
      >
        <div className="space-y-2">
          <Label htmlFor="gcvs_course_code">GCVS code</Label>
          <Input
            id="gcvs_course_code"
            name="gcvs_course_code"
            placeholder="Optional"
          />
        </div>
        <SubmitButton />
      </div>
    </form>
  );
}
