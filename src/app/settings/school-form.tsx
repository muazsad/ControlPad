"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Save } from "lucide-react";
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
import { US_TIME_ZONES } from "@/lib/schools/time-zones";

import { updateSchool, type SettingsFormState } from "./actions";

type Props = {
  name: string;
  smsName: string;
  timeZone: string;
};

const initialState: SettingsFormState = { error: null, success: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="h-10 min-w-36">
      <Save className="size-4" aria-hidden="true" />
      {pending ? "Saving..." : "Save school"}
    </Button>
  );
}

export function SchoolForm({ name, smsName, timeZone }: Props) {
  const [state, action] = useActionState(updateSchool, initialState);

  useEffect(() => {
    if (state.success) toast.success(state.success);
    if (state.error) toast.error("School not saved", { description: state.error });
  }, [state]);

  // A zone outside the US list (set before this form existed) stays selectable.
  const zones = US_TIME_ZONES.some((zone) => zone.value === timeZone)
    ? US_TIME_ZONES
    : [...US_TIME_ZONES, { value: timeZone, label: timeZone }];

  return (
    <Card className="border shadow-sm">
      <CardHeader>
        <CardTitle>School</CardTitle>
        <CardDescription>
          Your school&apos;s name, the name that starts every text, and the time zone that
          alert times follow.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="school_name">School name</Label>
            <Input id="school_name" name="school_name" defaultValue={name} required maxLength={80} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sms_name">Name on texts</Label>
            <Input id="sms_name" name="sms_name" defaultValue={smsName} maxLength={40} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="time_zone">Time zone</Label>
            <select
              id="time_zone"
              name="time_zone"
              defaultValue={timeZone}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {zones.map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label}
                </option>
              ))}
            </select>
          </div>
          {state.error ? <InlineError message={state.error} className="sm:col-span-3" /> : null}
          <div className="flex justify-end sm:col-span-3">
            <SubmitButton />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
