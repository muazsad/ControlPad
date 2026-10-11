import type { PaceTone } from "@/lib/grades/pace";
import { cn } from "@/lib/utils";

const barClasses: Record<PaceTone, string> = {
  success: "bg-status-success",
  warning: "bg-status-warning",
  danger: "bg-status-danger",
  neutral: "bg-status-neutral",
};

const textClasses: Record<PaceTone, string> = {
  success: "text-status-success",
  warning: "text-status-warning",
  danger: "text-status-danger",
  neutral: "text-muted-foreground",
};

type PaceBarProps = {
  /** GCVS % complete, or null if never recorded. */
  actual: number | null;
  /** Where the student should be today, or null without term/course dates. */
  expected: number | null;
  paceTone: PaceTone;
  missing: number | null;
  missingTone: PaceTone;
  className?: string;
};

const clamp = (value: number) => Math.min(100, Math.max(0, value));

/** Small "40% done · pace 55%" bar with a marker at the expected pace. */
export function PaceBar({
  actual,
  expected,
  paceTone,
  missing,
  missingTone,
  className,
}: PaceBarProps) {
  if (actual === null && expected === null && missing === null) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        No pace data yet
      </p>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={
          actual === null
            ? "% complete not recorded"
            : `${Math.round(actual)} percent complete${
                expected === null ? "" : `, pace ${Math.round(expected)} percent`
              }`
        }
      >
        {actual !== null ? (
          <div
            className={cn("h-full rounded-full", barClasses[paceTone])}
            style={{ width: `${clamp(actual)}%` }}
          />
        ) : null}
        {expected !== null ? (
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground/70"
            style={{ left: `calc(${clamp(expected)}% - 1px)` }}
          />
        ) : null}
      </div>
      <p className="text-xs tabular-nums">
        <span className={textClasses[paceTone]}>
          {actual === null ? "% complete not recorded" : `${Math.round(actual)}% done`}
          {expected !== null ? ` · pace ${Math.round(expected)}%` : ""}
        </span>
        {missing !== null ? (
          <span className={textClasses[missingTone]}>
            {" · "}
            {missing} missing
          </span>
        ) : null}
      </p>
    </div>
  );
}
