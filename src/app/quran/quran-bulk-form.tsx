"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, BookOpen } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineError } from "@/components/controlpad/inline-error";
import { cn } from "@/lib/utils";
import { studentName, type Student } from "@/lib/people/people";
import { parseJuzList } from "@/lib/quran/lessons";
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
          Blank boxes are skipped. Enter moves to the next box.
        </span>
      )}
      <Button type="submit" disabled={pending} className="h-10 min-w-36">
        {pending ? "Saving…" : "Log lessons"}
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
  const formRef = useRef<HTMLFormElement>(null);
  // Typed dhor juz per student, so they can be shown as chips.
  const [dhor, setDhor] = useState<Record<string, string>>({});
  const latestMap = new Map(latestEntries.map((e) => [e.student_id, e]));

  useEffect(() => {
    if (state.error) {
      toast.error("Could not save lessons", { description: state.error });
    }
    if (state.saved != null && !state.error) {
      toast.success(
        `${state.saved} entr${state.saved === 1 ? "y" : "ies"} logged for ${state.date}`,
      );
      // Clear the entry boxes (keep the date) so a second submit can't
      // log the same lessons twice.
      const keepDate = dateRef.current?.value;
      formRef.current?.reset();
      if (dateRef.current && keepDate) dateRef.current.value = keepDate;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDhor({});
    }
  }, [state]);

  // Enter / Shift+Enter move between entry boxes (same flow as the grade sweep).
  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    const target = event.target as HTMLElement;
    if (event.key !== "Enter" || !target.dataset.nav) return;
    event.preventDefault();
    const inputs = Array.from(
      formRef.current?.querySelectorAll<HTMLInputElement>("input[data-nav]") ?? [],
    );
    const index = inputs.indexOf(target as HTMLInputElement);
    const next = inputs[index + (event.shiftKey ? -1 : 1)];
    if (next) {
      next.focus();
      next.select();
    } else if (!event.shiftKey) {
      formRef.current?.querySelector<HTMLButtonElement>("button[type=submit]")?.focus();
    }
  }

  return (
    <form ref={formRef} action={formAction} onKeyDown={handleKeyDown}>
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

              <input type="hidden" name={`name_${student.id}`} value={studentName(student)} />

              {/* Sabaq | Sabaq para | Dhor */}
              <div className="grid gap-2 sm:grid-cols-[minmax(120px,160px)_minmax(110px,140px)_minmax(160px,1fr)]">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor={`lines_${student.id}`}>
                    Sabaq lines
                  </label>
                  <Input
                    id={`lines_${student.id}`}
                    name={`lines_${student.id}`}
                    data-nav="1"
                    placeholder="New lines"
                    inputMode="decimal"
                    className="h-8 text-sm"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor={`para_${student.id}`}>
                    Sabaq para juz
                  </label>
                  <Input
                    id={`para_${student.id}`}
                    name={`para_${student.id}`}
                    data-nav="1"
                    placeholder="1–30"
                    inputMode="numeric"
                    className="h-8 text-sm"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor={`dhor_${student.id}`}>
                    Dhor juz
                  </label>
                  <Input
                    id={`dhor_${student.id}`}
                    name={`dhor_${student.id}`}
                    data-nav="1"
                    placeholder="e.g. 3, 7"
                    inputMode="numeric"
                    className="h-8 text-sm"
                    autoComplete="off"
                    value={dhor[student.id] ?? ""}
                    onChange={(event) =>
                      setDhor((prev) => ({ ...prev, [student.id]: event.target.value }))
                    }
                  />
                  <DhorChips value={dhor[student.id] ?? ""} />
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

/** Typed dhor juz shown as chips (or a hint when the text isn't valid yet). */
function DhorChips({ value }: { value: string }) {
  if (value.trim() === "") return null;
  const parsed = parseJuzList(value);
  if (!parsed.ok) {
    return <p className="text-xs text-status-danger">{parsed.error}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {parsed.juz.map((juz) => (
        <span
          key={juz}
          className="rounded-md border bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums"
        >
          Juz {juz}
        </span>
      ))}
    </div>
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
