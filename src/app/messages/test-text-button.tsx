"use client";

import { useActionState, useEffect } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { sendTestText, type TestTextState } from "./actions";

export function TestTextButton() {
  const [state, action, pending] = useActionState<TestTextState, FormData>(
    sendTestText,
    { error: null, success: null },
  );

  useEffect(() => {
    if (state.error) toast.error("Test text failed", { description: state.error });
    if (state.success) toast.success(state.success);
  }, [state]);

  return (
    <form action={action}>
      <Button type="submit" variant="outline" disabled={pending} className="h-10">
        <Send className="size-4" aria-hidden="true" />
        {pending ? "Sending..." : "Send me a test text"}
      </Button>
    </form>
  );
}
