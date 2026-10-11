"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { MessageSquare, Save, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { InlineError } from "@/components/controlpad/inline-error";
import { StatusBadge } from "@/components/controlpad/status-badge";
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
  SPECIAL_DAY_MESSAGE_MAX_LENGTH,
  SPECIAL_DAY_NOTICE_TIME,
} from "@/lib/alerts/special-day-constants";
import {
  SPECIAL_DAY_TYPES,
  SPECIAL_DAY_TYPE_LABELS,
  UNGROUPED_SCOPE,
  type SpecialDay,
  type SpecialDayType,
} from "@/lib/schedule/calendar";
import { WHOLE_SCHOOL_SCOPE } from "@/lib/schedule/special-day-validation";
import { formatTime12h } from "@/lib/schedule/student-schedule";
import { cn } from "@/lib/utils";

import {
  applySpecialDayRange,
  deleteSpecialDay,
  saveSpecialDay,
  textParentsForSpecialDay,
  type SpecialDayFormState,
} from "./actions";

type GroupOption = { id: string; name: string };

type Props = {
  specialDays: SpecialDay[];
  groups: GroupOption[];
  /** Parent phones that would be texted, by special-day date. */
  recipientCounts: Record<string, number>;
};

const initialState: SpecialDayFormState = { error: null, success: null };

// Sensible starting options when the type is picked in the "Add" form.
function defaultsForType(type: SpecialDayType) {
  return {
    studentsExpected: type !== "no_school",
    sendAttendanceAlerts: type === "half_day" || type === "schedule_change",
  };
}

function useToastOnSuccess(state: SpecialDayFormState) {
  useEffect(() => {
    if (state.success) toast.success(state.success);
  }, [state]);
}

function SubmitButton({
  label,
  pendingLabel,
  icon: Icon,
  variant = "default",
}: {
  label: string;
  pendingLabel: string;
  icon: typeof Save;
  variant?: "default" | "outline";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} className="h-10">
      <Icon className="size-4" aria-hidden="true" />
      {pending ? pendingLabel : label}
    </Button>
  );
}

function Checkbox({
  name,
  label,
  checked,
  onChange,
  disabled,
  value,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  value?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 text-sm",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-primary"
      />
      {label}
    </label>
  );
}

/** Shared fields: type, times, note, expected/alerts toggles and scope. */
function DayOptionFields({
  idPrefix,
  initial,
  groups,
}: {
  idPrefix: string;
  initial?: SpecialDay;
  groups: GroupOption[];
}) {
  const [type, setType] = useState<SpecialDayType>(initial?.type ?? "no_school");
  const [expected, setExpected] = useState(
    initial ? initial.studentsExpected !== false && initial.type !== "no_school" : false,
  );
  const [alerts, setAlerts] = useState(initial ? initial.sendAttendanceAlerts !== false : false);
  const [scope, setScope] = useState<string[]>(initial?.appliesTo ?? []);
  const wholeSchool = scope.length === 0;
  const isNoSchool = type === "no_school";

  function changeType(next: SpecialDayType) {
    setType(next);
    if (!initial) {
      const defaults = defaultsForType(next);
      setExpected(defaults.studentsExpected);
      setAlerts(defaults.sendAttendanceAlerts);
    }
  }

  function toggleScope(token: string, on: boolean) {
    setScope((current) =>
      on ? Array.from(new Set([...current, token])) : current.filter((item) => item !== token),
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[11rem_8rem_8rem_1fr]">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-type`}>Type</Label>
          <select
            id={`${idPrefix}-type`}
            name="type"
            value={type}
            onChange={(event) => changeType(event.target.value as SpecialDayType)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {SPECIAL_DAY_TYPES.map((value) => (
              <option key={value} value={value}>
                {SPECIAL_DAY_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-start`}>Start</Label>
          <Input
            id={`${idPrefix}-start`}
            name="start_time"
            type="time"
            defaultValue={initial?.startTime ?? ""}
            disabled={isNoSchool || !expected}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-end`}>End</Label>
          <Input
            id={`${idPrefix}-end`}
            name="end_time"
            type="time"
            defaultValue={initial?.endTime ?? ""}
            disabled={isNoSchool || !expected}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-note`}>Note (staff only)</Label>
          <Input id={`${idPrefix}-note`} name="note" defaultValue={initial?.note ?? ""} />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Checkbox
          name="students_expected"
          label="Students expected"
          checked={!isNoSchool && expected}
          disabled={isNoSchool}
          onChange={setExpected}
        />
        <Checkbox
          name="send_attendance_alerts"
          label="Text parents about absences / tardies"
          checked={!isNoSchool && expected && alerts}
          disabled={isNoSchool || !expected}
          onChange={setAlerts}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Applies to</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Checkbox
            name="applies_to"
            value={WHOLE_SCHOOL_SCOPE}
            label="Whole school"
            checked={wholeSchool}
            onChange={(on) => on && setScope([])}
          />
          {groups.map((group) => (
            <Checkbox
              key={group.id}
              name="applies_to"
              value={group.id}
              label={group.name}
              checked={!wholeSchool && scope.includes(group.id)}
              onChange={(on) => toggleScope(group.id, on)}
            />
          ))}
          <Checkbox
            name="applies_to"
            value={UNGROUPED_SCOPE}
            label="Students without a group"
            checked={!wholeSchool && scope.includes(UNGROUPED_SCOPE)}
            onChange={(on) => toggleScope(UNGROUPED_SCOPE, on)}
          />
        </div>
      </fieldset>
    </div>
  );
}

function ParentMessageFields({ idPrefix, initial }: { idPrefix: string; initial?: SpecialDay }) {
  const [message, setMessage] = useState(initial?.parentMessage ?? "");
  const [notify, setNotify] = useState(initial?.notifyParents ?? false);

  return (
    <div className="space-y-2 rounded-lg border bg-muted/25 p-3">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${idPrefix}-message`} className="flex items-center gap-2">
          <MessageSquare className="size-4 text-primary" aria-hidden="true" />
          Text to parents
        </Label>
        <span
          className={cn(
            "text-xs text-muted-foreground",
            message.length > SPECIAL_DAY_MESSAGE_MAX_LENGTH && "text-status-danger",
          )}
        >
          {message.length}/{SPECIAL_DAY_MESSAGE_MAX_LENGTH}
        </span>
      </div>
      <textarea
        id={`${idPrefix}-message`}
        name="parent_message"
        rows={2}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder={`e.g. No GCVS on Thursday — students should still come at 8:00 AM for Quran.`}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <p className="text-xs text-muted-foreground">
        Sent as &ldquo;Salaam Institute: …&rdquo; to parents of students this day applies to.
      </p>
      <Checkbox
        name="notify_parents"
        label={`Text automatically at ${formatTime12h(SPECIAL_DAY_NOTICE_TIME)} the evening before`}
        checked={notify}
        onChange={setNotify}
      />
    </div>
  );
}

function AddSpecialDay({ groups }: { groups: GroupOption[] }) {
  const [formKey, setFormKey] = useState(0);
  const [state, action] = useActionState(
    async (prev: SpecialDayFormState, formData: FormData) => {
      const result = await saveSpecialDay(null, prev, formData);
      // Clear the form after a successful add.
      if (result.success) setFormKey((key) => key + 1);
      return result;
    },
    initialState,
  );
  useToastOnSuccess(state);

  return (
    <form key={formKey} action={action} className="space-y-3 rounded-lg border p-3">
      <div className="max-w-[12rem] space-y-2">
        <Label htmlFor="special-new-date">Date</Label>
        <Input id="special-new-date" name="date" type="date" required />
      </div>
      <DayOptionFields idPrefix="special-new" groups={groups} />
      <ParentMessageFields idPrefix="special-new" />
      {state.error ? <InlineError message={state.error} /> : null}
      <div className="flex justify-end">
        <SubmitButton label="Add special day" pendingLabel="Adding..." icon={Save} />
      </div>
    </form>
  );
}

function ApplyRange({ groups }: { groups: GroupOption[] }) {
  const [state, action] = useActionState(applySpecialDayRange, initialState);
  useToastOnSuccess(state);

  return (
    <details className="rounded-lg border bg-muted/25 p-3">
      <summary className="cursor-pointer text-sm font-medium">Apply to a date range</summary>
      <form action={action} className="mt-3 space-y-3">
        <div className="grid max-w-md grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="range-start">From</Label>
            <Input id="range-start" name="start_date" type="date" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="range-end">To</Label>
            <Input id="range-end" name="end_date" type="date" required />
          </div>
        </div>
        <DayOptionFields idPrefix="range" groups={groups} />
        <p className="text-xs text-muted-foreground">
          Ranges don&apos;t send parent texts. Add a message to one day in the range to text parents.
        </p>
        {state.error ? <InlineError message={state.error} /> : null}
        <div className="flex justify-end">
          <SubmitButton label="Apply range" pendingLabel="Applying..." icon={Save} />
        </div>
      </form>
    </details>
  );
}

function TextParentsNow({
  day,
  recipients,
}: {
  day: SpecialDay;
  recipients: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action] = useActionState(
    async () => {
      const result = await textParentsForSpecialDay(day.date);
      setConfirming(false);
      return result;
    },
    initialState,
  );
  useToastOnSuccess(state);

  if (!day.parentMessage?.trim()) return null;

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <span className="text-sm">
            Text {recipients} parent{recipients === 1 ? "" : "s"} now?
          </span>
          <SubmitButton label="Yes, send" pendingLabel="Sending..." icon={Send} />
          <Button type="button" variant="outline" className="h-10" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-10"
          disabled={recipients === 0}
          onClick={() => setConfirming(true)}
        >
          <Send className="size-4" aria-hidden="true" />
          Text parents now ({recipients})
        </Button>
      )}
      {state.error ? <InlineError message={state.error} className="w-full" /> : null}
    </form>
  );
}

function scopeLabel(day: SpecialDay, groups: GroupOption[]) {
  if (!day.appliesTo || day.appliesTo.length === 0) return "Whole school";
  const names = new Map(groups.map((group) => [group.id, group.name]));
  return day.appliesTo
    .map((token) => (token === UNGROUPED_SCOPE ? "No group" : names.get(token) ?? "Removed group"))
    .join(", ");
}

function EditSpecialDay({
  day,
  groups,
  recipients,
}: {
  day: SpecialDay;
  groups: GroupOption[];
  recipients: number;
}) {
  const [state, action] = useActionState(saveSpecialDay.bind(null, day.date), initialState);
  const [open, setOpen] = useState(false);
  useToastOnSuccess(state);
  const removeAction = deleteSpecialDay.bind(null, day.date);
  const closed = day.type === "no_school" || day.studentsExpected === false;

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{day.date}</span>
          <StatusBadge status={SPECIAL_DAY_TYPE_LABELS[day.type]} tone={closed ? "neutral" : "warning"} />
          <span className="text-sm text-muted-foreground">{scopeLabel(day, groups)}</span>
          {!closed && day.sendAttendanceAlerts === false ? (
            <StatusBadge status="Parent attendance texts off" tone="neutral" />
          ) : null}
          {day.parentsNotifiedAt ? (
            <StatusBadge
              status={`Parents texted ${new Date(day.parentsNotifiedAt).toLocaleString("en-US", {
                timeZone: "America/New_York",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}`}
              tone="success"
            />
          ) : day.notifyParents ? (
            <StatusBadge status={`Auto-text ${formatTime12h(SPECIAL_DAY_NOTICE_TIME)} day before`} tone="neutral" />
          ) : null}
        </div>
        <Button type="button" variant="outline" className="h-9" onClick={() => setOpen((value) => !value)}>
          {open ? "Close" : "Edit"}
        </Button>
      </div>
      {day.note ? <p className="mt-1 text-sm text-muted-foreground">{day.note}</p> : null}

      <div className="mt-3">
        <TextParentsNow day={day} recipients={recipients} />
      </div>

      {open ? (
        <div className="mt-3 space-y-3 border-t pt-3">
          <form action={action} className="space-y-3">
            <div className="max-w-[12rem] space-y-2">
              <Label htmlFor={`special-${day.date}-date`}>Date</Label>
              <Input id={`special-${day.date}-date`} name="date" type="date" defaultValue={day.date} required />
            </div>
            <DayOptionFields idPrefix={`special-${day.date}`} initial={day} groups={groups} />
            <ParentMessageFields idPrefix={`special-${day.date}`} initial={day} />
            {state.error ? <InlineError message={state.error} /> : null}
            <div className="flex justify-end">
              <SubmitButton label="Save" pendingLabel="Saving..." icon={Save} />
            </div>
          </form>
          <form action={removeAction} className="flex justify-end">
            <SubmitButton label="Remove" pendingLabel="Removing..." icon={Trash2} variant="outline" />
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function SpecialDaysForm({ specialDays, groups, recipientCounts }: Props) {
  return (
    <Card className="border shadow-sm">
      <CardHeader>
        <CardTitle>Special days</CardTitle>
        <CardDescription>
          No school, half days, schedule changes, no GCVS, field trips. Choose who it applies
          to, whether students are expected and whether parents get attendance texts — and
          optionally text parents about it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <AddSpecialDay groups={groups} />
        <ApplyRange groups={groups} />
        <div className="space-y-3">
          {specialDays.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
              No special days configured.
            </p>
          ) : (
            specialDays.map((day) => (
              <EditSpecialDay
                key={`${day.date}-${day.parentsNotifiedAt ?? ""}`}
                day={day}
                groups={groups}
                recipients={recipientCounts[day.date] ?? 0}
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
