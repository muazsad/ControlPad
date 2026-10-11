"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { CalendarClock, Send } from "lucide-react";
import { toast } from "sonner";

import { InlineError } from "@/components/controlpad/inline-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ANNOUNCEMENT_MAX_LENGTH,
  SCHEDULE_EARLIEST_TIME,
  SCHEDULE_LATEST_TIME,
  announcementBody,
  smsSegments,
} from "@/lib/announcements/announcements";
import { cn } from "@/lib/utils";

import { createAnnouncement, type AnnouncementFormState } from "./actions";

export type AudienceOption = { key: string; label: string; students: number };

/** One entry per active student: their group key and opaque family-phone ids (no numbers). */
export type CountingStudent = { group: string; families: number[] };

type Props = {
  options: AudienceOption[];
  students: CountingStudent[];
  /** School-local date to pre-fill when scheduling (tomorrow). */
  defaultDate: string;
  minDate: string;
};

const initialState: AnnouncementFormState = { error: null, success: null, version: 0 };

function familyCount(students: CountingStudent[], groups: Set<string> | null) {
  const families = new Set<number>();
  for (const student of students) {
    if (groups && !groups.has(student.group)) continue;
    for (const family of student.families) families.add(family);
  }
  return families.size;
}

function Choice({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
        checked ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/50",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="accent-primary"
      />
      {children}
    </label>
  );
}

export function ComposeForm(props: Props) {
  const [state, action, pending] = useActionState(createAnnouncement, initialState);

  useEffect(() => {
    if (state.error) toast.error("Announcement not sent", { description: state.error });
    if (state.success) toast.success(state.success);
  }, [state]);

  // Keyed on the success count so the form starts fresh after each announcement.
  return (
    <ComposeFields
      key={state.version}
      {...props}
      action={action}
      pending={pending}
      error={state.error}
    />
  );
}

function ComposeFields({
  options,
  students,
  defaultDate,
  minDate,
  action,
  pending,
  error,
}: Props & { action: (form: FormData) => void; pending: boolean; error: string | null }) {
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<"all" | "groups">("all");
  const [groups, setGroups] = useState<Set<string>>(new Set());
  const [when, setWhen] = useState<"now" | "schedule">("now");

  const recipients = useMemo(
    () => familyCount(students, audience === "all" ? null : groups),
    [students, audience, groups],
  );
  const body = message.trim() ? announcementBody(message) : "";
  const segments = smsSegments(body);
  const families = `${recipients} famil${recipients === 1 ? "y" : "ies"}`;

  return (
    <form
      action={action}
      className="space-y-5"
      onSubmit={(event) => {
        if (when === "now" && !window.confirm(`Text ${families} now? This can't be undone.`)) {
          event.preventDefault();
        }
      }}
    >
      {error ? <InlineError message={error} /> : null}

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="message">Message</Label>
          <span
            className={cn(
              "text-xs text-muted-foreground",
              message.length > ANNOUNCEMENT_MAX_LENGTH && "text-status-danger",
            )}
          >
            {message.length}/{ANNOUNCEMENT_MAX_LENGTH}
            {segments > 1 ? ` · ${segments} texts each` : ""}
          </span>
        </div>
        <textarea
          id="message"
          name="message"
          required
          rows={4}
          maxLength={ANNOUNCEMENT_MAX_LENGTH}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="e.g. No school this Friday for Eid. Classes resume Saturday at the usual time."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        {body ? (
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm leading-6">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Parents will see
            </span>
            {body}
          </p>
        ) : null}
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Send to</legend>
        <div className="flex flex-wrap gap-2">
          <Choice name="audience" value="all" checked={audience === "all"} onChange={() => setAudience("all")}>
            All parents
          </Choice>
          <Choice
            name="audience"
            value="groups"
            checked={audience === "groups"}
            onChange={() => setAudience("groups")}
          >
            Chosen groups
          </Choice>
        </div>
        {audience === "groups" ? (
          <div className="grid gap-2 pt-1 sm:grid-cols-2">
            {options.map((option) => (
              <label
                key={option.key}
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  name="groups"
                  value={option.key}
                  checked={groups.has(option.key)}
                  onChange={(event) => {
                    const next = new Set(groups);
                    if (event.target.checked) next.add(option.key);
                    else next.delete(option.key);
                    setGroups(next);
                  }}
                  className="accent-primary"
                />
                <span className="font-medium">{option.label}</span>
                <span className="text-muted-foreground">
                  · {option.students} student{option.students === 1 ? "" : "s"}
                </span>
              </label>
            ))}
          </div>
        ) : null}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">When</legend>
        <div className="flex flex-wrap gap-2">
          <Choice name="when" value="now" checked={when === "now"} onChange={() => setWhen("now")}>
            Send now
          </Choice>
          <Choice name="when" value="schedule" checked={when === "schedule"} onChange={() => setWhen("schedule")}>
            Schedule
          </Choice>
        </div>
        {when === "schedule" ? (
          <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" name="date" type="date" min={minDate} defaultValue={defaultDate} required className="h-10 w-full sm:w-44" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="time">Time</Label>
              <Input
                id="time"
                name="time"
                type="time"
                min={SCHEDULE_EARLIEST_TIME}
                max={SCHEDULE_LATEST_TIME}
                step={600}
                defaultValue="18:00"
                required
                className="h-10 w-full sm:w-36"
              />
            </div>
            <p className="text-xs text-muted-foreground sm:pb-3">
              Between 8:00 AM and 6:50 PM. Goes out within 10 minutes of this time.
            </p>
          </div>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {recipients === 0
            ? "No parent phone numbers for this selection."
            : `${families} will get one text (siblings share one).`}
        </p>
        <Button type="submit" disabled={pending || recipients === 0 || !message.trim()} className="h-10">
          {when === "now" ? (
            <Send className="size-4" aria-hidden="true" />
          ) : (
            <CalendarClock className="size-4" aria-hidden="true" />
          )}
          {pending ? "Working..." : when === "now" ? `Send to ${families}` : `Schedule for ${families}`}
        </Button>
      </div>
    </form>
  );
}
