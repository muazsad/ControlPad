"use client";

import { useActionState, useEffect, useRef } from "react";
import { MessageSquareReply } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { simulateInboundText, type SimulateInboundState } from "./actions";

export function SimulateInboundForm() {
  const bodyRef = useRef<HTMLInputElement>(null);
  const [state, action, pending] = useActionState<SimulateInboundState, FormData>(
    simulateInboundText,
    { error: null, success: null },
  );

  useEffect(() => {
    if (state.error) toast.error("Simulation failed", { description: state.error });
    if (state.success) {
      toast.success(state.success);
      if (bodyRef.current) bodyRef.current.value = "";
    }
  }, [state]);

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
      <div className="space-y-2">
        <Label htmlFor="sim-from">From (parent&apos;s phone)</Label>
        <Input id="sim-from" name="from" inputMode="tel" placeholder="(413) 555-0101" className="h-10" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sim-body">Message</Label>
        <Input
          id="sim-body"
          name="body"
          ref={bodyRef}
          placeholder="Amina is sick today"
          maxLength={500}
          className="h-10"
          required
        />
      </div>
      <Button type="submit" variant="outline" disabled={pending} className="h-10">
        <MessageSquareReply className="size-4" aria-hidden="true" />
        {pending ? "Processing..." : "Simulate text"}
      </Button>
    </form>
  );
}
