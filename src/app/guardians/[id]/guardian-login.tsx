"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, KeyRound } from "lucide-react";
import { toast } from "sonner";

import { InlineError } from "@/components/controlpad/inline-error";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { enableGuardianLogin, type ActionState } from "../actions";

type Props = {
  guardianId: string;
  hasLogin: boolean;
  email: string | null;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="h-10">
      {pending ? "Creating login..." : "Enable login"}
    </Button>
  );
}

export function GuardianLogin({ guardianId, hasLogin, email }: Props) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    enableGuardianLogin,
    { error: null },
  );

  useEffect(() => {
    if (state.error) {
      toast.error("Could not enable login", { description: state.error });
    }
  }, [state]);

  if (hasLogin) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-status-success/25 bg-status-success-soft p-4">
        <CheckCircle2
          className="mt-0.5 size-5 text-status-success"
          aria-hidden="true"
        />
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">Web login enabled</p>
            <StatusBadge status="Parent" tone="neutral" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {email ? `Signs in as ${email}. ` : ""}
            This guardian can view only their own children&apos;s records.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="guardian_id" value={guardianId} />
      {state.error ? <InlineError message={state.error} /> : null}
      <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
        <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          Optional. Create a password-based login so this guardian can sign in
          and see their children. Share the temporary password securely; they
          can change it later.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="login_email">Email</Label>
          <Input
            id="login_email"
            name="email"
            type="email"
            required
            defaultValue={email ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="login_password">Temporary password</Label>
          <Input
            id="login_password"
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
