import { GraduationCap } from "lucide-react";

import { cn } from "@/lib/utils";

type BrandMarkProps = {
  compact?: boolean;
  /** The signed-in user's school; omitted on sign-in and sign-up pages. */
  schoolName?: string;
  className?: string;
};

export function BrandMark({ compact = false, schoolName, className }: BrandMarkProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-gold text-brand-gold-foreground shadow-sm">
        <GraduationCap className="size-5" aria-hidden="true" />
      </div>
      {!compact && (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-5 text-inherit">
            {schoolName ?? "ControlPad"}
          </p>
          {schoolName ? (
            <p className="truncate text-xs leading-4 text-inherit/70">ControlPad</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
