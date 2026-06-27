import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "neutral";

type StatusBadgeProps = {
  status: string;
  tone?: StatusTone;
  className?: string;
};

const statusToneMap: Record<string, StatusTone> = {
  present: "success",
  paid: "success",
  "on-track": "success",
  "on track": "success",
  good: "success",
  clear: "success",
  tardy: "warning",
  due: "warning",
  "due soon": "warning",
  approaching: "warning",
  absent: "danger",
  overdue: "danger",
  slipping: "danger",
  low: "danger",
  "below floor": "danger",
  excused: "neutral",
  pending: "neutral",
  "no data": "neutral",
  none: "neutral",
};

const toneClasses: Record<StatusTone, string> = {
  success:
    "border-status-success/25 bg-status-success-soft text-status-success",
  warning:
    "border-status-warning/30 bg-status-warning-soft text-status-warning",
  danger: "border-status-danger/25 bg-status-danger-soft text-status-danger",
  neutral:
    "border-status-neutral/25 bg-status-neutral-soft text-status-neutral",
};

export function getStatusTone(status: string): StatusTone {
  return statusToneMap[status.toLowerCase()] ?? "neutral";
}

export function StatusBadge({ status, tone, className }: StatusBadgeProps) {
  const resolvedTone = tone ?? getStatusTone(status);

  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-semibold",
        toneClasses[resolvedTone],
        className,
      )}
    >
      {status}
    </Badge>
  );
}
