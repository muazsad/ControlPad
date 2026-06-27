"use client";

import { useActionState, useEffect } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { InlineError } from "@/components/controlpad/inline-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  createFirstAdminProfile,
  type SetupProfileState,
} from "./actions";

export function SetupProfileForm() {
  const [state, formAction] = useActionState<SetupProfileState, FormData>(
    createFirstAdminProfile,
    { error: null },
  );

  useEffect(() => {
    if (state.error) {
      toast.error("Profile was not created", { description: state.error });
    }
  }, [state.error]);

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? <InlineError message={state.error} /> : null}

      <div className="space-y-2">
        <Label htmlFor="full_name">Full name</Label>
        <Input
          id="full_name"
          name="full_name"
          type="text"
          required
          autoComplete="name"
        />
      </div>

      <div className="rounded-lg border bg-muted/40 px-3 py-3 text-sm leading-6 text-muted-foreground">
        <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
          <ShieldCheck className="size-4 text-status-success" aria-hidden="true" />
          First profile role
        </div>
        The first profile is created as the school admin. After that, this
        bootstrap screen closes and roles are assigned by the admin.
      </div>

      <Button type="submit" className="h-10 w-full">
        Create admin profile
      </Button>
    </form>
  );
}
