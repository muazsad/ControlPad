import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { StatusTone } from "./status-badge";

type SummaryCardProps = {
  title: string;
  value: string | number;
  description?: string;
  href?: string;
  icon?: LucideIcon;
  tone?: StatusTone;
  className?: string;
};

const toneClasses: Record<StatusTone, string> = {
  success: "border-status-success/30 bg-status-success-soft/45",
  warning: "border-status-warning/40 bg-status-warning-soft/70",
  danger: "border-status-danger/30 bg-status-danger-soft/70",
  neutral: "border-border bg-card",
};

const iconClasses: Record<StatusTone, string> = {
  success: "bg-status-success text-status-success-foreground",
  warning: "bg-status-warning text-status-warning-foreground",
  danger: "bg-status-danger text-status-danger-foreground",
  neutral: "bg-status-neutral text-status-neutral-foreground",
};

export function SummaryCard({
  title,
  value,
  description,
  href,
  icon: Icon,
  tone = "neutral",
  className,
}: SummaryCardProps) {
  const content = (
    <Card
      className={cn(
        "h-full border shadow-sm transition-colors hover:border-primary/30",
        toneClasses[tone],
        className,
      )}
    >
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-semibold text-foreground">
          {title}
        </CardTitle>
        {Icon && (
          <CardAction>
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-lg",
                iconClasses[tone],
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </span>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tracking-normal text-primary">
          {value}
        </div>
        {description && (
          <CardDescription className="mt-2 leading-5">
            {description}
          </CardDescription>
        )}
      </CardContent>
    </Card>
  );

  if (!href) return content;

  return (
    <Link href={href} className="block h-full focus-visible:outline-none">
      {content}
    </Link>
  );
}
