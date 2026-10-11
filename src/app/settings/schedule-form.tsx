"use client";

import { CalendarDays, Save, Trash2 } from "lucide-react";

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
  DEFAULT_WEEKLY_PATTERN,
  WEEKDAY_KEYS,
  dayType,
  type SchoolBreak,
  type SchoolCalendarConfig,
  type SpecialDay,
  type WeekdayKey,
  type WeeklyPattern,
} from "@/lib/schedule/calendar";
import { cn } from "@/lib/utils";

import {
  createBreak,
  deleteBreak,
  updateBreak,
  updateWeeklyPattern,
} from "./actions";
import { SpecialDaysForm } from "./special-days-form";

type Props = {
  weeklyPattern: WeeklyPattern;
  breaks: SchoolBreak[];
  specialDays: SpecialDay[];
  groups: { id: string; name: string }[];
  recipientCounts: Record<string, number>;
};

const weekdayLabels: Record<WeekdayKey, string> = {
  sunday: "Sun",
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthPreviewDays(config: SchoolCalendarConfig) {
  const now = new Date();
  const first = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const last = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
  const leadingBlanks = first.getUTCDay();
  const days: ({ date: string; label: number; type: ReturnType<typeof dayType> } | null)[] =
    Array.from({ length: leadingBlanks }, () => null);

  for (let day = 1; day <= last.getUTCDate(); day += 1) {
    const date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day));
    const dateString = isoDate(date);
    days.push({
      date: dateString,
      label: day,
      type: dayType(dateString, config),
    });
  }

  return {
    title: first.toLocaleString(undefined, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    days,
  };
}

function IconSubmitButton({
  label,
  icon,
  variant = "default",
}: {
  label: string;
  icon: "save" | "delete";
  variant?: "default" | "outline";
}) {
  const Icon = icon === "save" ? Save : Trash2;

  return (
    <Button type="submit" variant={variant} className="h-10">
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </Button>
  );
}

export function ScheduleForm({
  weeklyPattern,
  breaks,
  specialDays,
  groups,
  recipientCounts,
}: Props) {
  const calendarConfig: SchoolCalendarConfig = {
    weeklyPattern,
    breaks,
    specialDays,
  };
  const preview = monthPreviewDays(calendarConfig);

  return (
    <div className="space-y-5">
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle>Weekly school days</CardTitle>
          <CardDescription>
            School-wide open days. Used for students without a schedule group
            and for the Quran and digest checks. Grouped students follow their
            group&apos;s days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateWeeklyPattern} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-7">
              {WEEKDAY_KEYS.map((day) => (
                <label
                  key={day}
                  className={cn(
                    "flex min-h-20 cursor-pointer flex-col justify-between rounded-lg border bg-card p-3 text-sm transition-colors",
                    weeklyPattern[day] && "border-primary/40 bg-primary/5",
                  )}
                >
                  <span className="font-medium">{weekdayLabels[day]}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      name={day}
                      defaultChecked={weeklyPattern[day]}
                      className="size-4 accent-primary"
                    />
                    School
                  </span>
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <IconSubmitButton label="Save week" icon="save" />
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          <Card className="border shadow-sm">
            <CardHeader>
              <CardTitle>Breaks</CardTitle>
              <CardDescription>
                Breaks mark every date in the range as no school.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form action={createBreak} className="grid gap-3 md:grid-cols-[1fr_10rem_10rem_auto]">
                <div className="space-y-2">
                  <Label htmlFor="break-name">Name</Label>
                  <Input id="break-name" name="name" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="break-start">Start</Label>
                  <Input id="break-start" name="start_date" type="date" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="break-end">End</Label>
                  <Input id="break-end" name="end_date" type="date" required />
                </div>
                <div className="flex items-end">
                  <IconSubmitButton label="Add" icon="save" />
                </div>
              </form>

              <div className="space-y-3">
                {breaks.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                    No breaks configured.
                  </p>
                ) : (
                  breaks.map((schoolBreak) => {
                    const updateAction = updateBreak.bind(null, schoolBreak.id);
                    const deleteAction = deleteBreak.bind(null, schoolBreak.id);

                    return (
                      <div key={schoolBreak.id} className="rounded-lg border p-3">
                        <form
                          action={updateAction}
                          className="grid gap-3 md:grid-cols-[1fr_10rem_10rem_auto_auto]"
                        >
                          <Input
                            aria-label="Break name"
                            name="name"
                            defaultValue={schoolBreak.name}
                            required
                          />
                          <Input
                            aria-label="Break start date"
                            name="start_date"
                            type="date"
                            defaultValue={schoolBreak.startDate}
                            required
                          />
                          <Input
                            aria-label="Break end date"
                            name="end_date"
                            type="date"
                            defaultValue={schoolBreak.endDate}
                            required
                          />
                          <IconSubmitButton label="Save" icon="save" variant="outline" />
                        </form>
                        <form action={deleteAction} className="mt-2 flex justify-end">
                          <IconSubmitButton label="Remove" icon="delete" variant="outline" />
                        </form>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          <SpecialDaysForm
            specialDays={specialDays}
            groups={groups}
            recipientCounts={recipientCounts}
          />
        </div>

        <Card className="border shadow-sm">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Month preview</CardTitle>
                <CardDescription>{preview.title}</CardDescription>
              </div>
              <CalendarDays className="size-5 text-primary" aria-hidden="true" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
              {WEEKDAY_KEYS.map((day) => (
                <span key={day}>{weekdayLabels[day]}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {preview.days.map((day, index) =>
                day ? (
                  <div
                    key={day.date}
                    className={cn(
                      "flex aspect-square min-h-10 flex-col items-center justify-center rounded-md border text-xs",
                      day.type === "full" && "border-status-success/25 bg-status-success-soft",
                      day.type === "half" && "border-status-warning/30 bg-status-warning-soft",
                      day.type === "off" && "border-status-neutral/25 bg-status-neutral-soft",
                    )}
                    title={`${day.date}: ${day.type}`}
                  >
                    <span className="font-semibold">{day.label}</span>
                    <span className="text-[0.65rem] capitalize text-muted-foreground">
                      {day.type}
                    </span>
                  </div>
                ) : (
                  <div key={`blank-${index}`} aria-hidden="true" />
                ),
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge status="Full" tone="success" />
              <StatusBadge status="Half" tone="warning" />
              <StatusBadge status="Off" tone="neutral" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export const defaultScheduleFormValues = {
  weeklyPattern: DEFAULT_WEEKLY_PATTERN,
};
