"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, BookOpen } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineError } from "@/components/controlpad/inline-error";
import { cn } from "@/lib/utils";
import { studentName, type Student } from "@/lib/people/people";
import { logQuranLessons, type QuranBulkState } from "./actions";

type LatestEntry = {
  student_id: string;
  date: string;
  surah: string | null;
  lines_memorized: number;
};

type Props = {
  students: Student[];
  latestEntries: LatestEntry[];
  initialDate: string;
  quranInactivityDays: number | null;
};

function SubmitBar({ saved }: { saved?: number }) {
  const { pending } = useFormStatus();
  return (
    <div className="sticky bottom-0 z-10 flex items-center justify-between gap-4 border-t bg-card/95 px-4 py-3 backdrop-blur sm:px-6">
      {saved != null ? (
        <span className="flex items-center gap-2 text-sm text-status-success">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          {saved} lesson{saved === 1 ? "" : "s"} saved
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">
          Leave a student&apos;s lines blank to skip them.
        </span>
      )}
      <Button type="submit" disabled={pending} className="h-10 min-w-36">
        {pending ? "Saving…" : "Log lines"}
      </Button>
    </div>
  );
}

function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export function QuranBulkForm({
  students,
  latestEntries,
  initialDate,
  quranInactivityDays,
}: Props) {
  const [state, formAction] = useActionState<QuranBulkState, FormData>(
    logQuranLessons,
    { error: null },
  );
  const dateRef = useRef<HTMLInputElement>(null);
  const latestMap = new Map(latestEntries.map((e) => [e.student_id, e]));

  useEffect(() => {
    if (state.error) {
      toast.error("Could not save lessons", { description: state.error });
    }
    if (state.saved != null && !state.error) {
      toast.success(
        `${state.saved} entr${state.saved === 1 ? "y" : "ies"} logged for ${state.date}`,
      );
      // Reset all line fields but keep the date so the moderator can
      // quickly review what was just entered.
    }
  }, [state]);

  return (
    <form action={formAction}>
      {/* Student ID manifest — keeps the action aware of who's in the list */}
      <input
        type="hidden"
        name="student_ids"
        value={students.map((s) => s.id).join(",")}
      />

      {state.error ? (
        <div className="px-4 pb-4 sm:px-6">
          <InlineError message={state.error} />
        </div>
      ) : null}

      {/* Sticky date picker */}
      <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
        <label
          htmlFor="lesson_date"
          className="whitespace-nowrap text-sm font-medium"
        >
          Lesson date
        </label>
        <Input
          ref={dateRef}
          id="lesson_date"
          name="date"
          type="date"
          defaultValue={initialDate}
          className="h-9 w-40"
          required
        />
        <span className="text-xs text-muted-foreground">
          Applies to all rows you fill in below.
        </span>
      </div>

      {/* Per-student rows */}
      <div className="divide-y">
        {students.map((student) => {
          const latest = latestMap.get(student.id);
          const days = latest ? daysSince(latest.date) : null;
          const stale =
            days !== null &&
            quranInactivityDays !== null &&
            days >= quranInactivityDays;

          return (
            <div
              key={student.id}
              className={cn(
                "grid grid-cols-1 gap-3 px-4 py-4 sm:grid-cols-[180px_1fr] sm:items-start sm:px-6",
                stale && "bg-status-danger-soft/30",
              )}
            >
              {/* Student info */}
              <div className="min-w-0">
                <Link
                  href={`/quran/${student.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {studentName(student)}
                </Link>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {student.grade_level ?? "Grade not set"}
                </p>
                {latest ? (
                  <p
                    className={cn(
                      "mt-1 text-xs",
                      stale ? "text-status-danger" : "text-muted-foreground",
                    )}
                  >
                    Last: {latest.date}
                    {latest.surah ? ` · ${latest.surah}` : ""}
                    {stale ? ` (${days}d ago)` : ""}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    No entries yet
                  </p>
                )}
              </div>

              {/* Lines field */}
              <div className="grid gap-2 sm:grid-cols-[minmax(160px,220px)]">
                <div className="relative">
                  <Input
                    name={`lines_${student.id}`}
                    placeholder="Lines memorized"
                    type="number"
                    min={0}
                    step="0.5"
                    className="h-8 pr-10 text-sm"
                    title="Lines memorized"
                  />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    ln
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <SubmitBar saved={state.saved} />
    </form>
  );
}

export function QuranBulkFormEmpty() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <BookOpen className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <p className="font-medium">No active students</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        Add active students before logging Quran lessons.
      </p>
    </div>
  );
}
