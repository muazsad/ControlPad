"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { InlineError } from "@/components/controlpad/inline-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { US_TIME_ZONES } from "@/lib/schools/time-zones";

import { createSchool, type CreateSchoolState } from "./actions";

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState<CreateSchoolState, FormData>(
    createSchool,
    { error: null },
  );

  useEffect(() => {
    if (state.error) {
      toast.error("School was not created", { description: state.error });
    }
  }, [state.error]);

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? <InlineError message={state.error} /> : null}

      <div className="space-y-2">
        <Label htmlFor="school_name">School name</Label>
        <Input id="school_name" name="school_name" required minLength={2} maxLength={80} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sms_name">Name on texts</Label>
        <Input id="sms_name" name="sms_name" maxLength={40} />
        <p className="text-sm text-muted-foreground">
          Starts every text, e.g. &ldquo;Noor Academy: …&rdquo;. Leave blank to use the school
          name.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="time_zone">Time zone</Label>
        <select
          id="time_zone"
          name="time_zone"
          defaultValue="America/New_York"
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {US_TIME_ZONES.map((zone) => (
            <option key={zone.value} value={zone.value}>
              {zone.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="full_name">Your name</Label>
        <Input id="full_name" name="full_name" required autoComplete="name" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">Your mobile number (optional)</Label>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" />
        <p className="text-sm text-muted-foreground">
          Admin alerts and the daily summary are texted here.
        </p>
      </div>

      <Button type="submit" className="h-10 w-full" disabled={pending}>
        {pending ? "Creating school…" : "Create school"}
      </Button>
    </form>
  );
}
