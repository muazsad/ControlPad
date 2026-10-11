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
import { SWEEP_WINDOW_DAYS, parseGradeInput } from "@/lib/grades/sweep";

import { saveGradeSweep } from "../actions";

export type SweepRow = {
  courseId: string;
  studentId: string;
  studentName: string;
  courseName: string;
  groupId: string | null;
  lastValue: number | null;
  lastDate: string | null;
  /** From server data; only changes after a save. */
  updatedRecently: boolean;
};

export type SweepGroup = { id: string; name: string };

type Entries = Record<string, string>;

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

  // ── Entries that still correspond to a real course ─────────────────────────

  const courseIds = useMemo(
    () => new Set(rows.map((row) => row.courseId)),
    [rows],
  );

  const unsavedCount = useMemo(
    () =>
      Object.entries(entries).filter(
        ([courseId, value]) => courseIds.has(courseId) && hasText(value),
      ).length,
    [entries, courseIds],
  );

  const submittable = useMemo(
    () =>
      Object.entries(entries)
        .filter(
          ([courseId, value]) =>
            courseIds.has(courseId) && parseGradeInput(value).status === "ok",
        )
        .map(([courseId, value]) => ({ courseId, value })),
    [entries, courseIds],
  );

  const updatedCount = rows.filter((row) => row.updatedRecently).length;

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
            if (courseIds.has(courseId) && typeof value === "string" && hasText(value)) {
              restored[courseId] = value;
            }
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
      for (const [courseId, value] of Object.entries(entries)) {
        if (hasText(value)) draft[courseId] = value;
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

  const focusInput = useCallback((courseId: string | undefined) => {
    const input = courseId ? inputRefs.current.get(courseId) : undefined;
    if (!input) return false;
    input.focus();
    input.select();
    return true;
  }, []);

  useEffect(() => {
    focusInput(visibleRows[0]?.courseId);
    // Autofocus once on load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.nativeEvent.isComposing) return;
    const courseId = visibleRows[index].courseId;

    switch (event.key) {
      case "Enter":
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        const backwards = event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey);
        if (backwards) {
          focusInput(visibleRows[index - 1]?.courseId);
        } else if (!focusInput(visibleRows[index + 1]?.courseId)) {
          saveRef.current?.focus();
        }
        break;
      }
      case "Tab": {
        const target = visibleRows[index + (event.shiftKey ? -1 : 1)]?.courseId;
        // At either end, fall through to normal browser tabbing.
        if (target) {
          event.preventDefault();
          focusInput(target);
        }
        break;
      }
      case "Escape":
        event.preventDefault();
        setEntries((prev) => ({ ...prev, [courseId]: "" }));
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
      setEntries((prev) => {
        const next = { ...prev };
        for (const { courseId, value } of payload) {
          // Keep invalid ones, and anything edited while the save ran.
          if (!invalidIds.has(courseId) && next[courseId] === value) {
            delete next[courseId];
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
                <span className="tabular-nums">
                  {formatLastGrade(row.lastValue)}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {row.lastDate}
                  </span>
                </span>
              ),
          },
          {
            key: "new",
            header: "New grade",
            cell: (row) => {
              const index = visibleRows.findIndex(
                (r) => r.courseId === row.courseId,
              );
              const value = entries[row.courseId] ?? "";
              const invalid = parseGradeInput(value).status === "invalid";
              return (
                <Input
                  ref={(element) => {
                    if (element) inputRefs.current.set(row.courseId, element);
                    else inputRefs.current.delete(row.courseId);
                  }}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={value}
                  aria-label={`New grade for ${row.studentName}, ${row.courseName}`}
                  aria-invalid={invalid || undefined}
                  onChange={(event) =>
                    setEntries((prev) => ({
                      ...prev,
                      [row.courseId]: event.target.value,
                    }))
                  }
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  className="h-9 w-24 tabular-nums"
                />
              );
            },
          },
          {
            key: "status",
            header: "Status",
            cell: (row) => {
              const value = entries[row.courseId];
              const parsed = parseGradeInput(value ?? "");
              return (
                <div className="flex flex-wrap items-center gap-2">
                  {row.updatedRecently ? (
                    <StatusBadge status="Updated" tone="success" />
                  ) : row.lastValue === null ? (
                    <StatusBadge status="Never graded" tone="neutral" />
                  ) : (
                    <StatusBadge status="Needs update" tone="warning" />
                  )}
                  {parsed.status === "invalid" ? (
                    <span className="text-xs text-status-danger">
                      Enter 0–100, one decimal
                    </span>
                  ) : parsed.status === "ok" ? (
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
