"use client";

import { useActionState, useEffect, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { InlineError } from "@/components/controlpad/inline-error";
import { StatusBadge, type StatusTone } from "@/components/controlpad/status-badge";
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
import type { SmsMode } from "@/lib/sms/send-sms";
import { cn } from "@/lib/utils";

import type { SettingsFormState } from "./actions";
import { saveTextingSetup, setTextingMode } from "./texting-actions";

/** What the page may show about the school's Twilio setup. Never the token. */
export type TextingView = {
  accountSidMasked: string | null;
  hasToken: boolean;
  phone: string | null;
  testNumber: string | null;
  verified: boolean;
  requestedMode: SmsMode;
  liveApproved: boolean;
  effectiveMode: SmsMode;
  reason: string;
  webhookUrl: string;
};

const initialState: SettingsFormState = { error: null, success: null };

const MODE_LABELS: Record<SmsMode, string> = { off: "Off", test: "Test", live: "Live" };

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="h-10 min-w-36">
      <ShieldCheck className="size-4" aria-hidden="true" />
      {pending ? "Checking with Twilio..." : "Save & verify"}
    </Button>
  );
}

function statusOf(view: TextingView): { label: string; tone: StatusTone } {
  if (!view.accountSidMasked) return { label: "Not set up", tone: "neutral" };
  if (!view.verified) return { label: "Not verified", tone: "warning" };
  return { label: "Verified", tone: "success" };
}

export function TextingForm({ view }: { view: TextingView }) {
  const [state, action] = useActionState(saveTextingSetup, initialState);
  const [switching, startSwitch] = useTransition();
  const status = statusOf(view);

  useEffect(() => {
    if (state.success) toast.success(state.success);
    if (state.error) toast.error("Texting setup", { description: state.error });
  }, [state]);

  function chooseMode(mode: SmsMode) {
    startSwitch(async () => {
      const result = await setTextingMode(mode);
      if (result.error) toast.error("Mode not changed", { description: result.error });
      else toast.success(`Texting mode: ${MODE_LABELS[mode]}`);
    });
  }

  return (
    <Card id="texting" className="scroll-mt-24 border shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Texting <StatusBadge status={status.label} tone={status.tone} />
        </CardTitle>
        <CardDescription className="max-w-3xl">
          Texts go out from your school&apos;s own Twilio account and number. Paste the Account
          SID and Auth Token from the Twilio console. ControlPad stores the token encrypted
          and never shows it again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="account_sid">Account SID</Label>
            <Input
              id="account_sid"
              name="account_sid"
              autoComplete="off"
              placeholder={view.accountSidMasked ?? "AC…"}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="auth_token">Auth Token</Label>
            <Input
              id="auth_token"
              name="auth_token"
              type="password"
              autoComplete="off"
              placeholder={view.hasToken ? "Saved — leave blank to keep" : ""}
              required={!view.hasToken}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Twilio phone number</Label>
            <Input id="phone" name="phone" type="tel" defaultValue={view.phone ?? ""} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="test_number">Test number (optional)</Label>
            <Input id="test_number" name="test_number" type="tel" defaultValue={view.testNumber ?? ""} />
            <p className="text-xs text-muted-foreground">
              In test mode every text goes here instead of to parents.
            </p>
          </div>
          {state.error ? <InlineError message={state.error} className="sm:col-span-2" /> : null}
          <div className="flex justify-end sm:col-span-2">
            <SaveButton />
          </div>
        </form>

        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">Mode</p>
          <div className="flex flex-wrap gap-2">
            {(["off", "test", "live"] as const).map((mode) => (
              <Button
                key={mode}
                type="button"
                variant={view.requestedMode === mode ? "default" : "outline"}
                className={cn("h-9 min-w-20")}
                disabled={switching || (!view.verified && mode !== "off")}
                onClick={() => chooseMode(mode)}
              >
                {MODE_LABELS[mode]}
              </Button>
            ))}
          </div>
          {view.requestedMode === "live" && !view.liveApproved ? (
            <p className="text-sm text-status-warning">
              Waiting for ControlPad approval. Until then texts go to your test number (or are
              only logged if you have none).
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Right now: <span className="font-medium text-foreground">{MODE_LABELS[view.effectiveMode]}</span>{" "}
            — {view.reason}
          </p>
        </div>

        <div className="rounded-lg border bg-muted/40 px-3 py-3 text-sm leading-6 text-muted-foreground">
          <p className="font-medium text-foreground">Incoming texts</p>
          In Twilio, open your number and set <span className="font-medium">A message comes in</span>{" "}
          to webhook <code className="rounded bg-background px-1">{view.webhookUrl}</code> (HTTP POST).
          Parents&apos; replies and absence texts then reach your Attendance page.
        </div>
      </CardContent>
    </Card>
  );
}
