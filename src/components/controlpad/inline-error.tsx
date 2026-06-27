import { AlertCircle } from "lucide-react";

import { cn } from "@/lib/utils";

type InlineErrorProps = {
  message: string;
  className?: string;
};

export function InlineError({ message, className }: InlineErrorProps) {
  return (
    <div
      className={cn(
        "flex gap-2 rounded-lg border border-status-danger/25 bg-status-danger-soft px-3 py-2 text-sm leading-5 text-status-danger",
        className,
      )}
      role="alert"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
