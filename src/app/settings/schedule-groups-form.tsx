"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Save, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { InlineError } from "@/components/controlpad/inline-error";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  WEEKDAY_LABELS,
  type ScheduleGroup,
  type ScheduleGroupDay,
} from "@/lib/schedule/student-schedule";
import { cn } from "@/lib/utils";

import {
  createScheduleGroup,
  deleteScheduleGroup,
  updateScheduleGroup,
  type ScheduleGroupFormState,
} from "./actions";

type Props = {
  groups: ScheduleGroup[];
  studentCounts: Record<string, number>;
  ungroupedCount: number;
};

// Pre-filled values for a day that's switched on in a brand-new group.
const BLANK_DAY = { startTime: "08:00", tardyGraceMinutes: 10, absenceCheckTime: "10:00" };
// Display order: Monday first.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="h-10">
      <Save className="size-4" aria-hidden="true" />
      {pending ? "Saving..." : label}
    </Button>
  );
}

function DayRow({ weekday, day }: { weekday: number; day?: ScheduleGroupDay }) {
  const [on, setOn] = useState(Boolean(day));
  const values = day ?? BLANK_DAY;
  const label = WEEKDAY_LABELS[weekday];

  return (
    <div
      className={cn(
        "grid grid-cols-2 items-center gap-2 rounded-lg border p-2 sm:grid-cols-[8rem_1fr_1fr_1fr]",
        on ? "border-primary/40 bg-primary/5" : "bg-card",
      )}
    >
      <label className="col-span-2 flex cursor-pointer items-center gap-2 text-sm font-medium sm:col-span-1">
        <input
          type="checkbox"
          name={`day_${weekday}_on`}
          checked={on}
          onChange={(event) => setOn(event.target.checked)}
          className="size-4 accent-primary"
        />
        {label}
      </label>
      <Input
        aria-label={`${label} start time`}
        name={`day_${weekday}_start`}
        type="time"
        defaultValue={values.startTime}
        disabled={!on}
        className="h-9"
      />
      <Input
        aria-label={`${label} tardy grace minutes`}
        name={`day_${weekday}_grace`}
        type="number"
        min={0}
        max={240}
        step={1}
        defaultValue={values.tardyGraceMinutes}
        disabled={!on}
        className="h-9"
      />
      <Input
        aria-label={`${label} absence check time`}
        name={`day_${weekday}_check`}
        type="time"
        defaultValue={values.absenceCheckTime}
        disabled={!on}
        className="col-span-2 h-9 sm:col-span-1"
      />
    </div>
  );
}

function GroupEditor({
  group,
  submitLabel,
  action,
}: {
  group?: ScheduleGroup;
  submitLabel: string;
  action: (state: ScheduleGroupFormState, form: FormData) => Promise<ScheduleGroupFormState>;
}) {
  const [state, formAction] = useActionState<ScheduleGroupFormState, FormData>(action, {
    error: null,
    success: null,
  });
  useEffect(() => {
    if (state.error) toast.error("Could not save group", { description: state.error });
    if (state.success) toast.success(state.success);
  }, [state]);

  const idPrefix = group?.id ?? "new";

  return (
    <form action={formAction} className="space-y-4">
      {group ? <input type="hidden" name="id" value={group.id} /> : null}
      {state.error ? <InlineError message={state.error} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-name`}>Group name</Label>
          <Input
            id={`${idPrefix}-name`}
            name="name"
            defaultValue={group?.name ?? ""}
            placeholder="e.g. Quran only"
            required
            className="h-10"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-description`}>Description</Label>
          <Input
            id={`${idPrefix}-description`}
            name="description"
            defaultValue={group?.description ?? ""}
            placeholder="Optional"
            className="h-10"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="hidden grid-cols-[8rem_1fr_1fr_1fr] gap-2 px-2 text-xs font-medium text-muted-foreground sm:grid">
          <span>Day</span>
          <span>Start time</span>
          <span>Tardy grace (min)</span>
          <span>Absence check</span>
        </div>
        {WEEKDAY_ORDER.map((weekday) => (
          <DayRow
            key={weekday}
            weekday={weekday}
            day={group?.days.find((day) => day.weekday === weekday)}
          />
        ))}
      </div>

      <div className="flex justify-end">
        <SaveButton label={submitLabel} />
      </div>
    </form>
  );
}

export function ScheduleGroupsForm({ groups, studentCounts, ungroupedCount }: Props) {
  return (
    <Card className="border shadow-sm">
      <CardHeader>
        <CardTitle>Schedule groups</CardTitle>
        <CardDescription className="max-w-3xl">
          Each student belongs to a group that sets which days they attend and their times.
          Arriving after <em>start time + tardy grace</em> counts as tardy. At the{" "}
          <em>absence check</em> time, the admin is texted a list of the group&apos;s students
          who are still unmarked or absent; parents are texted after the parent alert delay
          if nobody corrects attendance. Breaks and no-school days apply to every group.
        </CardDescription>
        {ungroupedCount > 0 ? (
          <p className="text-sm text-status-warning">
            {ungroupedCount} active student{ungroupedCount === 1 ? " is" : "s are"} not in a
            group and use the school-wide start time and weekly days.
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6">
        {groups.map((group) => {
          const count = studentCounts[group.id] ?? 0;
          const deleteAction = deleteScheduleGroup.bind(null, group.id);
          return (
            <div key={group.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="size-4" aria-hidden="true" />
                  {count} active student{count === 1 ? "" : "s"}
                </p>
                <form
                  action={deleteAction}
                  onSubmit={(event) => {
                    const message =
                      count > 0
                        ? `Delete ${group.name}? Its ${count} student(s) will fall back to the school-wide schedule.`
                        : `Delete ${group.name}?`;
                    if (!window.confirm(message)) event.preventDefault();
                  }}
                >
                  <Button type="submit" variant="outline" size="sm">
                    <Trash2 className="size-4" aria-hidden="true" />
                    Delete group
                  </Button>
                </form>
              </div>
              <GroupEditor group={group} submitLabel="Save group" action={updateScheduleGroup} />
            </div>
          );
        })}

        <div className="space-y-3 rounded-lg border border-dashed p-4">
          <p className="flex items-center gap-2 font-medium">
            <Plus className="size-4" aria-hidden="true" />
            New group
          </p>
          {/* Keyed on the group count so the form resets after a successful create. */}
          <GroupEditor
            key={groups.length}
            submitLabel="Create group"
            action={createScheduleGroup}
          />
        </div>
      </CardContent>
    </Card>
  );
}
