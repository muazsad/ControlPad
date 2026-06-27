"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { InlineError } from "@/components/controlpad/inline-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createModerator, type ActionState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="h-10">
      {pending ? "Creating..." : "Create moderator"}
    </Button>
  );
}

export function CreateModeratorForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(
    createModerator,
    { error: null, success: null },
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.error) {
      toast.error("Could not create moderator", { description: state.error });
    }
    if (state.success) {
      toast.success("Moderator created", { description: state.success });
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      {state.error ? <InlineError message={state.error} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="full_name">Full name</Label>
          <Input id="full_name" name="full_name" required autoComplete="off" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone (optional)</Label>
          <Input
            id="phone"
            name="phone"
            inputMode="tel"
            placeholder="413-555-1234"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Temporary password</Label>
          <Input
            id="password"
            name="password"
            type="text"
            required
            minLength={8}
            placeholder="At least 8 characters"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
