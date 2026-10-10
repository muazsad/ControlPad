"use client";

import { useActionState } from "react";
import { Clock, Save } from "lucide-react";

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
  isToday: boolean;
  status: AttendanceStatus | null;
  arrivedAt: string | null;
  note: string | null;
};

const initialState: AttendanceActionState = { error: null };

const choices: { value: string; label: string }[] = [
  { value: "auto", label: "From arrival time" },
  { value: "present", label: "Present" },
  { value: "tardy", label: "Tardy" },
  { value: "absent", label: "Absent" },
  { value: "excused", label: "Excused" },
];

export function AttendanceRowForm({
  studentId,
  date,
  isToday,
  status,
  arrivedAt,
  note,
}: AttendanceRowFormProps) {
  const [state, action, pending] = useActionState(markAttendance, initialState);
  // Arrival-based records stay on "From arrival time" so editing the time re-decides tardy.
  const defaultChoice =
    status === null || ((status === "present" || status === "tardy") && arrivedAt)
      ? "auto"
      : status;
  const showArrivedNow = isToday && status !== "present" && status !== "tardy";

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="student_id" value={studentId} />
      <input type="hidden" name="date" value={date} />
      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        {showArrivedNow ? (
          <Button
            type="submit"
            name="intent"
            value="arrived_now"
            size="sm"
            disabled={pending}
            className="h-9"
          >
            <Clock className="size-4" aria-hidden="true" />
            Arrived now
          </Button>
        ) : null}
        <Input
          name="arrived_at"
          type="time"
          aria-label="Arrival time"
          defaultValue={arrivedAt?.slice(0, 5) ?? ""}
          className="h-9 w-full lg:w-32"
        />
        <Select name="status" defaultValue={defaultChoice}>
          <SelectTrigger className="h-9 w-full min-w-40 lg:w-44" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          name="note"
          defaultValue={note ?? ""}
          placeholder="Note"
          className="h-9 min-w-0 lg:w-40"
        />
        <Button
          type="submit"
          name="intent"
          value="save"
          size="sm"
          variant="outline"
          disabled={pending}
          className="h-9"
        >
          <Save className="size-4" aria-hidden="true" />
          {pending ? "Saving" : "Save"}
        </Button>
        {state.saved ? <StatusBadge status="Saved" tone="success" /> : null}
      </div>
      {state.error ? <InlineError message={state.error} /> : null}
    </form>
  );
}
