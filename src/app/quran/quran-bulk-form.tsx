"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, BookOpen, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineError } from "@/components/controlpad/inline-error";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { cn } from "@/lib/utils";
import { studentName, type Student } from "@/lib/people/people";
import { formatJuzPages, parseJuzPages } from "@/lib/quran/lessons";
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
  /** Students on an open juz test → the juz being tested. */
  juzTests?: Record<string, number>;
};

type RowEntry = { lines: string; para: string; dhor: string };

const EMPTY_ROW: RowEntry = { lines: "", para: "", dhor: "" };

function isFilled(entry: RowEntry | undefined): boolean {
  return !!entry && (entry.lines.trim() !== "" || entry.para.trim() !== "" || entry.dhor.trim() !== "");
}

/** Which student a pending submit is for: an id (a row's Save) or "all". */
function usePendingTarget(): string | null {
  const { pending, data } = useFormStatus();
  if (!pending) return null;
  const only = data?.get("only");
  return typeof only === "string" && only !== "" ? only : "all";
}

function SubmitBar({ filledCount }: { filledCount: number }) {
  const target = usePendingTarget();
  return (
    <div className="sticky bottom-0 z-10 flex items-center justify-between gap-4 border-t bg-card/95 px-4 py-3 backdrop-blur sm:px-6">
      <span className="text-sm text-muted-foreground">
        {filledCount > 0
          ? `${filledCount} student${filledCount === 1 ? "" : "s"} filled in, not saved yet.`
          : "Save each student as you go, or fill in several and save them all at once."}
      </span>
      <Button
        type="submit"
        disabled={target !== null || filledCount === 0}
        className="h-10 min-w-36"
      >
        {target === "all"
          ? "Saving…"
          : filledCount > 1
            ? `Save all ${filledCount}`
            : "Save all"}
      </Button>
    </div>
  );
}

/** A row's own Save button: submits just this student. */
function RowSaveButton({
  studentId,
  filled,
  saved,
}: {
  studentId: string;
  filled: boolean;
  saved: boolean;
}) {
  const target = usePendingTarget();
  if (saved && !filled) {
    return (
      <span className="flex h-8 items-center gap-1.5 text-sm font-medium text-status-success">
        <CheckCircle2 className="size-4" aria-hidden="true" />
        Saved
      </span>
    );
  }
  return (
    <Button
      type="submit"
      name="only"
      value={studentId}
      variant={filled ? "default" : "outline"}
      size="sm"
      disabled={!filled || target !== null}
      className="h-8 min-w-20"
    >
      {target === studentId || (target === "all" && filled) ? (
        "Saving…"
      ) : (
        <>
          <Check className="size-4" aria-hidden="true" />
          Save
        </>
      )}
    </Button>
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
  juzTests = {},
}: Props) {
  const [state, formAction] = useActionState<QuranBulkState, FormData>(
    logQuranLessons,
    { error: null },
  );
  const formRef = useRef<HTMLFormElement>(null);
  // Controlled, so React's post-action form reset can't jump it back to today.
  const [date, setDate] = useState(initialDate);
  // What's typed in each student's row (sabaq lines, sabaq para, dhor).
  const [entries, setEntries] = useState<Record<string, RowEntry>>({});
  // Students saved since the page loaded, to show a "Saved" tick on their row.
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const latestMap = new Map(latestEntries.map((e) => [e.student_id, e]));
  const nameById = new Map(students.map((s) => [s.id, studentName(s)]));
  const filledCount = students.filter((s) => isFilled(entries[s.id])).length;

  function setField(studentId: string, field: keyof RowEntry, value: string) {
    setEntries((prev) => ({
      ...prev,
      [studentId]: { ...(prev[studentId] ?? EMPTY_ROW), [field]: value },
    }));
  }

  useEffect(() => {
    const ids = state.savedStudentIds ?? [];
    if (ids.length > 0) {
      // Clear only the rows that were saved, so a second click can't log the
      // same lessons twice and other rows keep what the teacher typed.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntries((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      setSavedIds((prev) => new Set([...prev, ...ids]));
    }
    if (state.error) {
      toast.error(ids.length > 0 ? "Saved with a problem" : "Could not save", {
        description: state.error,
      });
    } else if (ids.length > 0) {
      toast.success(
        ids.length === 1
          ? `Saved ${nameById.get(ids[0]) ?? "1 student"} for ${state.date}`
          : `Saved ${ids.length} students for ${state.date}`,
      );
    }
    // nameById is rebuilt every render; only a new action result should fire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Enter / Shift+Enter move between entry boxes (same flow as the grade sweep).
  // Enter never submits the form by itself: with a Save button on every row the
  // browser would otherwise pick the first row's button.
  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    const target = event.target as HTMLElement;
    if (event.key !== "Enter" || target.tagName !== "INPUT") return;
    event.preventDefault();
    if (!target.dataset.nav) return;
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
          id="lesson_date"
          name="date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="h-9 w-40"
          required
        />
        <span className="text-xs text-muted-foreground">
          Applies to every student you save below.
        </span>
      </div>

      {/* Per-student rows */}
      <div className="divide-y">
        {students.map((student) => {
          const latest = latestMap.get(student.id);
          const days = latest ? daysSince(latest.date) : null;
          const testJuz = juzTests[student.id];
          // On a juz test sabaq isn't expected, so no stale highlight.
          const entry = entries[student.id] ?? EMPTY_ROW;
          const filled = isFilled(entry);
          const stale =
            testJuz === undefined &&
            days !== null &&
            quranInactivityDays !== null &&
            days >= quranInactivityDays;

          return (
            <div
              key={student.id}
              className={cn(
                "grid grid-cols-1 gap-3 px-4 py-4 sm:grid-cols-[180px_1fr] sm:items-start sm:px-6",
                stale && "bg-status-danger-soft/30",
                filled && !stale && "bg-accent/40",
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
                {testJuz !== undefined ? (
                  <div className="mt-1">
                    <StatusBadge status={`On juz test · Juz ${testJuz}`} tone="warning" />
                  </div>
                ) : null}
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

              {/* Sabaq | Sabaq para | Dhor | Save */}
              <div className="grid gap-2 sm:grid-cols-[minmax(110px,140px)_minmax(140px,180px)_minmax(180px,1fr)_auto]">
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
                    value={entry.lines}
                    onChange={(event) => setField(student.id, "lines", event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor={`para_${student.id}`}>
                    Sabaq para (juz: pages)
                  </label>
                  <Input
                    id={`para_${student.id}`}
                    name={`para_${student.id}`}
                    data-nav="1"
                    placeholder="e.g. 3: 1-5"
                    className="h-8 text-sm"
                    autoComplete="off"
                    value={entry.para}
                    onChange={(event) => setField(student.id, "para", event.target.value)}
                  />
                  <SectionChips value={entry.para} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor={`dhor_${student.id}`}>
                    Dhor (juz: pages)
                  </label>
                  <Input
                    id={`dhor_${student.id}`}
                    name={`dhor_${student.id}`}
                    data-nav="1"
                    placeholder="e.g. 3: 1-5, 7: 10-20"
                    className="h-8 text-sm"
                    autoComplete="off"
                    value={entry.dhor}
                    onChange={(event) => setField(student.id, "dhor", event.target.value)}
                  />
                  <SectionChips value={entry.dhor} />
                </div>
                <div className="space-y-1">
                  <span aria-hidden="true" className="hidden text-xs sm:block">
                    &nbsp;
                  </span>
                  <RowSaveButton
                    studentId={student.id}
                    filled={filled}
                    saved={savedIds.has(student.id)}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <SubmitBar filledCount={filledCount} />
    </form>
  );
}

/** Typed revision sections shown as chips (or a hint when the text isn't valid yet). */
function SectionChips({ value }: { value: string }) {
  if (value.trim() === "") return null;
  const parsed = parseJuzPages(value);
  if (!parsed.ok) {
    return <p className="text-xs text-status-danger">{parsed.error}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {parsed.entries.map((entry) => (
        <span
          key={`${entry.juz}:${entry.fromPage}`}
          className="rounded-md border bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums"
        >
          {formatJuzPages(entry)}
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
