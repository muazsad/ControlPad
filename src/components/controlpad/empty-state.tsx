import type { LucideIcon } from "lucide-react";
import { CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  className?: string;
};

export function EmptyState({
  title,
  description,
  icon: Icon = CheckCircle2,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-36 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-8 text-center",
        className,
      )}
    >
      <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-status-success-soft text-status-success">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
