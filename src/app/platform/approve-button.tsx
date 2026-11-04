"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { setLiveApproval } from "./actions";

export function ApproveButton({ schoolId, approved }: { schoolId: string; approved: boolean }) {
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const result = await setLiveApproval(schoolId, !approved);
      if (result.error) toast.error("Not changed", { description: result.error });
      else toast.success(approved ? "Live texting revoked." : "Live texting approved.");
    });
  }

  return (
    <Button
      type="button"
      variant={approved ? "outline" : "default"}
      className="h-9"
      disabled={pending}
      onClick={toggle}
    >
      {approved ? "Revoke" : "Approve live"}
    </Button>
  );
}
