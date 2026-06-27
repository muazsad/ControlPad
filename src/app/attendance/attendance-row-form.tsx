"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";

import {
  markAttendance,
  type AttendanceActionState,
  type AttendanceStatus,
} from "@/app/attendance/actions";
import { InlineError } from "@/components/controlpad/inline-error";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AttendanceRowFormProps = {
  studentId: string;
  date: string;
  status: AttendanceStatus | null;
  note: string | null;
};

const initialState: AttendanceActionState = { error: null };

const statuses: AttendanceStatus[] = ["present", "tardy", "absent", "excused"];

export function AttendanceRowForm({
  studentId,
  date,
  status,
  note,
}: AttendanceRowFormProps) {
  const [state, action, pending] = useActionState(markAttendance, initialState);
  const currentStatus = status ?? "present";

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="student_id" value={studentId} />
      <input type="hidden" name="date" value={date} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select name="status" defaultValue={currentStatus}>
          <SelectTrigger className="h-9 w-full min-w-32 sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statuses.map((item) => (
              <SelectItem key={item} value={item}>
                <span className="capitalize">{item}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          name="note"
          defaultValue={note ?? ""}
          placeholder="Note"
          className="h-9 min-w-0 sm:w-48"
        />
        <Button type="submit" size="sm" disabled={pending} className="h-9">
          <Save className="size-4" aria-hidden="true" />
          {pending ? "Saving" : "Save"}
        </Button>
        {state.saved ? <StatusBadge status="Saved" tone="success" /> : null}
      </div>
      {state.error ? <InlineError message={state.error} /> : null}
    </form>
  );
}
