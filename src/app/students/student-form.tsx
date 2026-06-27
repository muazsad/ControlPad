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
import {
  enrollmentStatuses,
  type EnrollmentStatus,
  type Student,
} from "@/lib/people/people";
import type { ActionState } from "./actions";

type StudentFormProps = {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  student?: Student;
  submitLabel: string;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="h-10">
      {pending ? "Saving..." : label}
    </Button>
  );
}

export function StudentForm({ action, student, submitLabel }: StudentFormProps) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {
    error: null,
  });
  const [enrollment, setEnrollment] = useState<EnrollmentStatus>(
    student?.enrollment_status ?? "active",
  );

  useEffect(() => {
    if (state.error) {
      toast.error("Could not save student", { description: state.error });
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-5">
      {student ? <input type="hidden" name="id" value={student.id} /> : null}
      {state.error ? <InlineError message={state.error} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="first_name">First name</Label>
          <Input
            id="first_name"
            name="first_name"
            required
            defaultValue={student?.first_name ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="last_name">Last name</Label>
          <Input
            id="last_name"
            name="last_name"
            required
            defaultValue={student?.last_name ?? ""}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="date_of_birth">Date of birth</Label>
          <Input
            id="date_of_birth"
            name="date_of_birth"
            type="date"
            defaultValue={student?.date_of_birth ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="grade_level">Grade level</Label>
          <Input
            id="grade_level"
            name="grade_level"
            placeholder="e.g. 7th grade"
            defaultValue={student?.grade_level ?? ""}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="enrollment_status">Enrollment status</Label>
          <input type="hidden" name="enrollment_status" value={enrollment} />
          <Select
            value={enrollment}
            onValueChange={(v) => setEnrollment(v as EnrollmentStatus)}
          >
            <SelectTrigger id="enrollment_status" className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {enrollmentStatuses.map((status) => (
                <SelectItem key={status} value={status} className="capitalize">
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="gcvs_reference">GCVS reference</Label>
          <Input
            id="gcvs_reference"
            name="gcvs_reference"
            placeholder="Optional GCVS ID"
            defaultValue={student?.gcvs_reference ?? ""}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}
