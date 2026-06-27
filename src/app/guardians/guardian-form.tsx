"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { InlineError } from "@/components/controlpad/inline-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Guardian } from "@/lib/people/people";
import type { ActionState } from "./actions";

type GuardianFormProps = {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  guardian?: Guardian;
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

export function GuardianForm({
  action,
  guardian,
  submitLabel,
}: GuardianFormProps) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {
    error: null,
  });

  useEffect(() => {
    if (state.error) {
      toast.error("Could not save guardian", { description: state.error });
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-5">
      {guardian ? <input type="hidden" name="id" value={guardian.id} /> : null}
      {state.error ? <InlineError message={state.error} /> : null}

      <div className="space-y-2">
        <Label htmlFor="full_name">Full name</Label>
        <Input
          id="full_name"
          name="full_name"
          required
          defaultValue={guardian?.full_name ?? ""}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="phone">Phone (SMS)</Label>
          <Input
            id="phone"
            name="phone"
            required
            inputMode="tel"
            placeholder="413-555-1234"
            defaultValue={guardian?.phone ?? ""}
          />
          <p className="text-xs text-muted-foreground">
            Stored in E.164 format for Twilio (e.g. +14135551234).
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email (optional)</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={guardian?.email ?? ""}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}
