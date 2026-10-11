"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import { GraduationCap, Save } from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/controlpad/data-table";
import { EmptyState } from "@/components/controlpad/empty-state";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PaceTone } from "@/lib/grades/pace";
import {
  SWEEP_WINDOW_DAYS,
  invalidMessage,
  parseGradeInput,
  parseMissingInput,
  type SweepField,
} from "@/lib/grades/sweep";

import { saveGradeSweep } from "../actions";

export type SweepRow = {
  courseId: string;
  studentId: string;
  studentName: string;
  courseName: string;
  groupId: string | null;
  lastValue: number | null;
  lastDate: string | null;
  lastPercent: number | null;
  lastMissing: number | null;
  /** Where the student should be today (null = no term/course dates). */
  expectedPercent: number | null;
  paceTone: PaceTone;
  missingTone: PaceTone;
  /** From server data; only changes after a save. */
  updatedRecently: boolean;
};

export type SweepGroup = { id: string; name: string };

type SweepFields = Record<SweepField, string>;
type Entries = Record<string, SweepFields>;

/** Left-to-right order of the inputs in a row. */
const FIELDS: SweepField[] = ["grade", "percent", "missing"];
const FIELD_LABELS: Record<SweepField, string> = {
  grade: "Grade",
  percent: "% complete",
  missing: "Missing",
};
const EMPTY_FIELDS: SweepFields = { grade: "", percent: "", missing: "" };

const toneText: Record<PaceTone, string> = {
  success: "text-status-success",
  warning: "text-status-warning",
  danger: "text-status-danger",
  neutral: "text-muted-foreground",
};

function fieldsOf(entries: Entries, courseId: string): SweepFields {
  return entries[courseId] ?? EMPTY_FIELDS;
}

function rowHasText(fields: SweepFields | undefined): boolean {
  return Boolean(fields) && FIELDS.some((field) => hasText(fields?.[field]));
}

/** The first invalid field in a row, if any. */
function firstInvalid(fields: SweepFields): SweepField | null {
  for (const field of FIELDS) {
    const parsed =
      field === "missing"
        ? parseMissingInput(fields[field])
        : parseGradeInput(fields[field]);
    if (parsed.status === "invalid") return field;
  }
  return null;
}

function fieldIsInvalid(field: SweepField, value: string): boolean {
  const parsed = field === "missing" ? parseMissingInput(value) : parseGradeInput(value);
  return parsed.status === "invalid";
}

const DRAFT_KEY_PREFIX = "grade-sweep-draft";
const GROUP_ALL = "all";
const GROUP_NONE = "none";

function draftKey(userId: string, todayKey: string) {
  return `${DRAFT_KEY_PREFIX}:${userId}:${todayKey}`;
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

function formatLastGrade(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export function SweepForm({
  userId,
  todayKey,
  rows,
  groups,
}: {
  userId: string;
  todayKey: string;
  rows: SweepRow[];
  groups: SweepGroup[];
}) {
  const [entries, setEntries] = useState<Entries>({});
  /** Messages from the last save for rows the server rejected. */
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [groupFilter, setGroupFilter] = useState(GROUP_ALL);
  const [search, setSearch] = useState("");
  const [onlyStale, setOnlyStale] = useState(false);
  const [pending, startTransition] = useTransition();

  const [hydrated, setHydrated] = useState(false);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const saveRef = useRef<HTMLButtonElement>(null);
  const restoredRef = useRef(false);

  const key = draftKey(userId, todayKey);
  const hasUngrouped = rows.some((row) => row.groupId === null);

  // ── Filtering (hides rows only; entries are untouched) ─────────────────────

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (groupFilter === GROUP_NONE && row.groupId !== null) return false;
      if (
        groupFilter !== GROUP_ALL &&
        groupFilter !== GROUP_NONE &&
        row.groupId !== groupFilter
      ) {
        return false;
      }
      if (onlyStale && row.updatedRecently) return false;
      if (
        needle &&
        !row.studentName.toLowerCase().includes(needle) &&
        !row.courseName.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    });
  }, [rows, groupFilter, search, onlyStale]);

  // Show the student's name only on their first visible course row.
  const tableRows = useMemo(
    () =>
      visibleRows.map((row, index) => ({
        ...row,
        showStudent:
          index === 0 || visibleRows[index - 1].studentId !== row.studentId,
      })),
    [visibleRows],
  );

  const rowIndex = useMemo(
    () => new Map(visibleRows.map((row, index) => [row.courseId, index])),
    [visibleRows],
  );

  // ── Entries that still correspond to a real course ─────────────────────────

  const courseIds = useMemo(
    () => new Set(rows.map((row) => row.courseId)),
    [rows],
  );

  const unsavedCount = useMemo(
    () =>
      Object.entries(entries).filter(
        ([courseId, fields]) => courseIds.has(courseId) && rowHasText(fields),
      ).length,
    [entries, courseIds],
  );

  // A row is submitted only when it has text and every field in it is valid.
  const submittable = useMemo(
    () =>
      Object.entries(entries)
        .filter(
          ([courseId, fields]) =>
            courseIds.has(courseId) && rowHasText(fields) && firstInvalid(fields) === null,
        )
        .map(([courseId, fields]) => ({
          courseId,
          value: fields.grade,
          percent: fields.percent,
          missing: fields.missing,
        })),
    [entries, courseIds],
  );

  const updatedCount = rows.filter((row) => row.updatedRecently).length;

  function setField(courseId: string, field: SweepField, value: string) {
    setEntries((prev) => ({
      ...prev,
      [courseId]: { ...fieldsOf(prev, courseId), [field]: value },
    }));
    setServerErrors((prev) => {
      if (!(courseId in prev)) return prev;
      const next = { ...prev };
      delete next[courseId];
      return next;
    });
  }

  // ── Draft safety net (every storage access guarded) ────────────────────────

  // Restoring from localStorage must happen after mount (SSR has no storage),
  // so setState-in-effect is intentional here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const restored: Entries = {};
          for (const [courseId, value] of Object.entries(parsed)) {
            if (!courseIds.has(courseId)) continue;
            // Older drafts stored just the grade as a string.
            const fields: SweepFields =
              typeof value === "string"
                ? { ...EMPTY_FIELDS, grade: value }
                : value && typeof value === "object"
                  ? {
                      grade: String((value as Partial<SweepFields>).grade ?? ""),
                      percent: String((value as Partial<SweepFields>).percent ?? ""),
                      missing: String((value as Partial<SweepFields>).missing ?? ""),
                    }
                  : EMPTY_FIELDS;
            if (rowHasText(fields)) restored[courseId] = fields;
          }
          const count = Object.keys(restored).length;
          if (count > 0) {
            setEntries(restored);
            toast.info(
              `Restored ${count} unsaved ${count === 1 ? "entry" : "entries"}`,
            );
          }
        }
      }
    } catch {
      // Storage unavailable or draft unreadable: start clean.
    }
    setHydrated(true);
  }, [key, courseIds]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hydrated) return;
    try {
      const draft: Entries = {};
      for (const [courseId, fields] of Object.entries(entries)) {
        if (rowHasText(fields)) draft[courseId] = fields;
      }
      if (Object.keys(draft).length === 0) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, JSON.stringify(draft));
      }
    } catch {
      // Ignore: the draft is a convenience only.
    }
  }, [entries, hydrated, key]);

  useEffect(() => {
    if (unsavedCount === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsavedCount]);

  // ── Keyboard ───────────────────────────────────────────────────────────────

  const focusInput = useCallback(
    (courseId: string | undefined, field: SweepField) => {
      const input = courseId ? inputRefs.current.get(`${courseId}:${field}`) : undefined;
      if (!input) return false;
      input.focus();
      input.select();
      return true;
    },
    [],
  );

  useEffect(() => {
    focusInput(visibleRows[0]?.courseId, "grade");
    // Autofocus once on load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enter / arrows move within a column; Tab moves across the row, then down.
  function handleKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    index: number,
    field: SweepField,
  ) {
    if (event.nativeEvent.isComposing) return;
    const courseId = visibleRows[index].courseId;
    const fieldIndex = FIELDS.indexOf(field);

    switch (event.key) {
      case "Enter":
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        const backwards = event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey);
        if (backwards) {
          focusInput(visibleRows[index - 1]?.courseId, field);
        } else if (!focusInput(visibleRows[index + 1]?.courseId, field)) {
          saveRef.current?.focus();
        }
        break;
      }
      case "Tab": {
        let targetRow = index;
        let targetField = fieldIndex + (event.shiftKey ? -1 : 1);
        if (targetField >= FIELDS.length) {
          targetRow += 1;
          targetField = 0;
        } else if (targetField < 0) {
          targetRow -= 1;
          targetField = FIELDS.length - 1;
        }
        const target = visibleRows[targetRow]?.courseId;
        // At either end, fall through to normal browser tabbing.
        if (target) {
          event.preventDefault();
          focusInput(target, FIELDS[targetField]);
        }
        break;
      }
      case "Escape":
        event.preventDefault();
        setField(courseId, field, "");
        break;
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  function handleSave() {
    const payload = submittable;
    if (payload.length === 0) return;

    startTransition(async () => {
      let result;
      try {
        result = await saveGradeSweep(payload);
      } catch {
        toast.error("Could not save the sweep. Your entries are still here.");
        return;
      }

      if (result.error) {
        toast.error(result.error);
        return;
      }

      const invalidIds = new Set(result.invalid.map((item) => item.courseId));
      setServerErrors(
        Object.fromEntries(
          result.invalid.map((item) => [item.courseId, invalidMessage(item.field, item.reason)]),
        ),
      );
      setEntries((prev) => {
        const next = { ...prev };
        for (const sent of payload) {
          const current = next[sent.courseId];
          // Keep rejected rows, and anything edited while the save ran.
          if (
            !invalidIds.has(sent.courseId) &&
            current &&
            current.grade === sent.value &&
            current.percent === sent.percent &&
            current.missing === sent.missing
          ) {
            delete next[sent.courseId];
          }
        }
        return next;
      });

      const message = `Saved ${result.saved}, ${result.skippedUnchanged} unchanged, ${result.invalid.length} invalid`;
      if (result.invalid.length > 0) toast.warning(message);
      else toast.success(message);
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No courses to update"
        description="Active students with courses will appear here."
        icon={GraduationCap}
      />
    );
  }

  function fieldInput(
    row: SweepRow,
    field: SweepField,
    placeholder: string,
  ) {
    const index = rowIndex.get(row.courseId) ?? 0;
    const value = fieldsOf(entries, row.courseId)[field];
    return (
      <Input
        ref={(element) => {
          const refKey = `${row.courseId}:${field}`;
          if (element) inputRefs.current.set(refKey, element);
          else inputRefs.current.delete(refKey);
        }}
        type="text"
        inputMode={field === "missing" ? "numeric" : "decimal"}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        aria-label={`${FIELD_LABELS[field]} for ${row.studentName}, ${row.courseName}`}
        aria-invalid={fieldIsInvalid(field, value) || undefined}
        onChange={(event) => setField(row.courseId, field, event.target.value)}
        onKeyDown={(event) => handleKeyDown(event, index, field)}
        className="h-9 w-20 tabular-nums"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm lg:flex-row lg:items-end">
        <div className="grid flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
          <div className="space-y-1.5">
            <Label htmlFor="sweep-search">Search</Label>
            <Input
              id="sweep-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Student or course"
              className="h-10"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sweep-group">Schedule group</Label>
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger id="sweep-group" className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GROUP_ALL}>All groups</SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
                {hasUngrouped ? (
                  <SelectItem value={GROUP_NONE}>No group</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          type="button"
          variant={onlyStale ? "default" : "outline"}
          aria-pressed={onlyStale}
          className="h-10"
          onClick={() => setOnlyStale((value) => !value)}
        >
          Only not updated in last {SWEEP_WINDOW_DAYS} days
        </Button>
        <Button
          ref={saveRef}
          type="button"
          className="h-10"
          onClick={handleSave}
          disabled={pending || submittable.length === 0}
        >
          <Save className="size-4" aria-hidden="true" />
          {pending ? "Saving…" : "Save sweep"}
          {submittable.length > 0 ? ` (${submittable.length})` : ""}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground tabular-nums">
            {updatedCount} of {rows.length}
          </span>{" "}
          courses updated in the last {SWEEP_WINDOW_DAYS} days
        </p>
        <p className="tabular-nums">
          Showing {visibleRows.length} of {rows.length}
          {unsavedCount > 0 ? ` · ${unsavedCount} unsaved` : ""}
        </p>
      </div>

      <DataTable
        data={tableRows}
        getRowKey={(row) => row.courseId}
        empty={
          <EmptyState
            title="No courses match these filters"
            description="Clear the search or filters to see more rows. Anything you typed is kept."
            icon={GraduationCap}
          />
        }
        columns={[
          {
            key: "student",
            header: "Student",
            cell: (row) =>
              row.showStudent ? (
                <Link
                  href={`/students/${row.studentId}`}
                  tabIndex={-1}
                  className="font-medium text-primary hover:underline"
                >
                  {row.studentName}
                </Link>
              ) : null,
          },
          { key: "course", header: "Course", cell: (row) => row.courseName },
          {
            key: "last",
            header: "Last grade",
            cell: (row) =>
              row.lastValue === null ? (
                <span className="text-muted-foreground">never</span>
              ) : (
                <div className="space-y-0.5">
                  <span className="tabular-nums">
                    {formatLastGrade(row.lastValue)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {row.lastDate}
                    </span>
                  </span>
                  {row.lastPercent !== null || row.lastMissing !== null ? (
                    <p className="text-xs tabular-nums">
                      {row.lastPercent !== null ? (
                        <span className={toneText[row.paceTone]}>
                          {Math.round(row.lastPercent)}% done
                          {row.expectedPercent !== null
                            ? ` · pace ${Math.round(row.expectedPercent)}%`
                            : ""}
                        </span>
                      ) : null}
                      {row.lastMissing !== null ? (
                        <span className={toneText[row.missingTone]}>
                          {row.lastPercent !== null ? " · " : ""}
                          {row.lastMissing} missing
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              ),
          },
          { key: "grade", header: "Grade", cell: (row) => fieldInput(row, "grade", "0–100") },
          {
            key: "percent",
            header: "% complete",
            cell: (row) => fieldInput(row, "percent", "0–100"),
          },
          { key: "missing", header: "Missing", cell: (row) => fieldInput(row, "missing", "0") },
          {
            key: "status",
            header: "Status",
            cell: (row) => {
              const fields = fieldsOf(entries, row.courseId);
              const invalidField = firstInvalid(fields);
              const serverError = serverErrors[row.courseId];
              return (
                <div className="flex flex-wrap items-center gap-2">
                  {row.updatedRecently ? (
                    <StatusBadge status="Updated" tone="success" />
                  ) : row.lastValue === null ? (
                    <StatusBadge status="Never graded" tone="neutral" />
                  ) : (
                    <StatusBadge status="Needs update" tone="warning" />
                  )}
                  {serverError ? (
                    <span className="text-xs text-status-danger">{serverError}</span>
                  ) : invalidField ? (
                    <span className="text-xs text-status-danger">
                      Check {FIELD_LABELS[invalidField].toLowerCase()}
                    </span>
                  ) : rowHasText(fields) ? (
                    <span className="text-xs text-muted-foreground">unsaved</span>
                  ) : null}
                </div>
              );
            },
          },
        ]}
      />
    </div>
  );
}
