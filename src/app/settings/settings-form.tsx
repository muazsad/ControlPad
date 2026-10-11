"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Save } from "lucide-react";
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

import { updateSettings, type SettingsFormState } from "./actions";
import type { SettingsValues } from "./settings-validation";

type Props = {
  settings: SettingsValues & {
    updated_at: string;
  };
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="h-10 min-w-36">
      <Save className="size-4" aria-hidden="true" />
      {pending ? "Saving..." : "Save changes"}
    </Button>
  );
}

function Field({
  label,
  name,
  type = "number",
  min,
  max,
  step,
  defaultValue,
  hint,
  required = true,
}: {
  label: string;
  name: keyof SettingsValues;
  type?: "number" | "time" | "date";
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  defaultValue: string | number;
  hint: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        min={min}
        max={max}
        step={step}
        defaultValue={defaultValue}
        className="h-10"
        required={required}
      />
      <p className="text-xs leading-5 text-muted-foreground">{hint}</p>
    </div>
  );
}

export function SettingsForm({ settings }: Props) {
  const [state, formAction] = useActionState<SettingsFormState, FormData>(
    updateSettings,
    { error: null, success: null },
  );

  useEffect(() => {
    if (state.error) {
      toast.error("Could not save settings", { description: state.error });
    }
    if (state.success) {
      toast.success(state.success);
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? <InlineError message={state.error} /> : null}
      {state.success ? (
        <div className="flex gap-2 rounded-lg border border-status-success/25 bg-status-success-soft px-3 py-2 text-sm leading-5 text-status-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{state.success}</span>
        </div>
      ) : null}

      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle>Alert thresholds</CardTitle>
          <CardDescription>
            These values control automated SMS alerts and dashboard status.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Grade floor"
            name="grade_floor"
            min={0}
            max={100}
            step={0.1}
            defaultValue={settings.grade_floor}
            hint="Grades below this percent trigger low-grade alerts."
          />
          <Field
            label="Tardy window"
            name="tardy_window_hours"
            min={0}
            max={8}
            step={0.25}
            defaultValue={settings.tardy_window_hours}
            hint="For students without a schedule group: hours after school start before the admin is alerted about missing students."
          />
          <Field
            label="Parent alert delay"
            name="parent_alert_delay_minutes"
            min={0}
            max={480}
            step={5}
            defaultValue={settings.parent_alert_delay_minutes}
            hint="Minutes after the admin is alerted about missing students before their parents are texted, if nobody has corrected attendance."
          />
          <Field
            label="Tardies per week"
            name="tardies_per_week"
            min={1}
            max={20}
            step={1}
            defaultValue={settings.tardies_per_week}
            hint="Rolling seven-day tardy count that alerts guardians."
          />
          <Field
            label="Quran inactivity"
            name="quran_inactivity_days"
            min={1}
            max={60}
            step={1}
            defaultValue={settings.quran_inactivity_days}
            hint="Days without a lesson before a Quran slip alert."
          />
          <Field
            label="Stale grade days"
            name="stale_grade_school_days"
            min={1}
            max={90}
            step={1}
            defaultValue={settings.stale_grade_school_days}
            hint="School days a course can go without a grade update before staff see it as stale. Staff only; parents are not texted."
          />
          <Field
            label="Payment due day"
            name="payment_due_day"
            min={1}
            max={28}
            step={1}
            defaultValue={settings.payment_due_day}
            hint="Day of the month after which unpaid tuition is overdue."
          />
        </CardContent>
      </Card>

      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle>School day timing</CardTitle>
          <CardDescription>
            Times are stored in the school&apos;s local operating schedule.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Field
            label="School start"
            name="school_start"
            type="time"
            defaultValue={settings.school_start.slice(0, 5)}
            hint="For students without a schedule group. Grouped students use their group's times below."
          />
          <Field
            label="Admin digest time"
            name="admin_digest_time"
            type="time"
            defaultValue={settings.admin_digest_time.slice(0, 5)}
            hint="Earliest time the daily admin digest should send."
          />
        </CardContent>
      </Card>

      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle>Term &amp; pace</CardTitle>
          <CardDescription>
            Used to work out where each student should be in a course. A course
            can override these dates on its own page. Leave both term dates
            blank to turn pace off for courses without their own dates.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Term start"
            name="term_start"
            type="date"
            required={false}
            defaultValue={settings.term_start ?? ""}
            hint="First day of the school term."
          />
          <Field
            label="Term end"
            name="term_end"
            type="date"
            required={false}
            defaultValue={settings.term_end ?? ""}
            hint="Last day of the school term."
          />
          <Field
            label="Pace gap threshold"
            name="pace_gap_threshold"
            min={1}
            max={100}
            step={1}
            defaultValue={settings.pace_gap_threshold}
            hint="Percentage points behind expected pace before parents and the admin are alerted. Twice this shows as red."
          />
          <Field
            label="Missing assignments threshold"
            name="missing_assignments_threshold"
            min={1}
            max={100}
            step={1}
            defaultValue={settings.missing_assignments_threshold}
            hint="Missing assignments in one course before parents and the admin are alerted."
          />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Last updated{" "}
          {new Date(settings.updated_at).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
        <SubmitButton />
      </div>
    </form>
  );
}
