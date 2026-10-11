"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { setJuzMemorized } from "../actions";

export type JuzCell = {
  juz: number;
  memorized: boolean;
  /** Revision tone for memorized juz; neutral when not memorized or not shown. */
  tone: "success" | "warning" | "danger" | "neutral";
  /** Tooltip, e.g. "Last revised 2026-10-01 · 12 school days ago". */
  title: string;
};

const toneClasses: Record<JuzCell["tone"], string> = {
  success: "border-status-success/40 bg-status-success-soft text-status-success",
  warning: "border-status-warning/40 bg-status-warning-soft text-status-warning",
  danger: "border-status-danger/40 bg-status-danger-soft text-status-danger",
  neutral: "border-border bg-muted/60 text-foreground",
};

/** 30 juz; staff click a cell to mark or unmark it memorized. */
export function JuzGrid({
  studentId,
  cells,
  canEdit,
}: {
  studentId: string;
  cells: JuzCell[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function toggle(cell: JuzCell) {
    startTransition(async () => {
      const result = await setJuzMemorized({
        studentId,
        juz: cell.juz,
        memorized: !cell.memorized,
      });
      if (result.error) toast.error("Could not update juz", { description: result.error });
    });
  }

  return (
    <div className="grid grid-cols-5 gap-2 sm:grid-cols-10" aria-busy={pending}>
      {cells.map((cell) => {
        const className = cn(
          "flex h-11 flex-col items-center justify-center rounded-md border text-sm font-semibold tabular-nums",
          cell.memorized
            ? toneClasses[cell.tone]
            : "border-dashed border-border bg-transparent text-muted-foreground",
        );
        const label = `Juz ${cell.juz}: ${cell.title}`;
        return canEdit ? (
          <button
            key={cell.juz}
            type="button"
            title={`${cell.title}${cell.memorized ? " · click to unmark" : " · click to mark memorized"}`}
            aria-label={label}
            aria-pressed={cell.memorized}
            disabled={pending}
            onClick={() => toggle(cell)}
            className={cn(className, "transition-colors hover:ring-2 hover:ring-ring/40 disabled:opacity-60")}
          >
            {cell.juz}
          </button>
        ) : (
          <div key={cell.juz} title={cell.title} aria-label={label} className={className}>
            {cell.juz}
          </div>
        );
      })}
    </div>
  );
}
