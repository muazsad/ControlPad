import Link from "next/link";
import { ClipboardCheck } from "lucide-react";

import { EmptyState } from "@/components/controlpad/empty-state";
import { StatusBadge, type StatusTone } from "@/components/controlpad/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ChecklistStudent, TeacherChecklist } from "@/lib/people/staff-accountability";

/** Names listed per gap before "+N more". */
const MAX_NAMES = 5;

function names(students: ChecklistStudent[]) {
  const shown = students.slice(0, MAX_NAMES).map((student) => student.name);
  const extra = students.length - shown.length;
  return shown.join(", ") + (extra > 0 ? `, +${extra} more` : "");
}

function Gap({
  label,
  done,
  total,
  missing,
  pendingNote,
  href,
}: {
  label: string;
  done: number;
  total: number;
  missing: ChecklistStudent[];
  pendingNote?: string | null;
  href: string;
}) {
  const tone: StatusTone = missing.length > 0 ? "warning" : done === total ? "success" : "neutral";
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        <StatusBadge status={`${done}/${total}`} tone={tone} />
      </div>
      {missing.length > 0 ? (
        <p className="text-xs leading-5 text-muted-foreground">
          <Link href={href} className="font-medium text-status-warning hover:underline">
            Missing:
          </Link>{" "}
          {names(missing)}
        </p>
      ) : null}
      {pendingNote ? <p className="text-xs text-muted-foreground">{pendingNote}</p> : null}
    </div>
  );
}

export function StaffChecklistSection({
  rows,
  anyTeacherAssigned,
}: {
  rows: TeacherChecklist[];
  anyTeacherAssigned: boolean;
}) {
  const outstanding = rows.filter((row) => !row.complete && row.teacherId !== null).length;

  return (
    <Card className="border shadow-sm">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Staff checklist</CardTitle>
          <CardDescription>
            Today&apos;s attendance and Quran logging, by each group&apos;s responsible teacher.
            {anyTeacherAssigned ? null : (
              <>
                {" "}
                Assign teachers in{" "}
                <Link href="/settings" className="font-medium text-primary hover:underline">
                  Settings → Schedule groups
                </Link>
                .
              </>
            )}
          </CardDescription>
        </div>
        <StatusBadge
          status={outstanding > 0 ? `${outstanding} outstanding` : "All clear"}
          tone={outstanding > 0 ? "warning" : "success"}
        />
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            title="Nothing to check today"
            description="No students are expected today."
            icon={ClipboardCheck}
          />
        ) : (
          <div className="divide-y rounded-lg border">
            {rows.map((row) => (
              <div
                key={row.teacherId ?? "unassigned"}
                className="grid gap-3 p-4 md:grid-cols-[minmax(0,14rem)_1fr_1fr_auto] md:items-start"
              >
                <div className="min-w-0">
                  <p
                    className={
                      row.teacherId ? "font-semibold" : "font-semibold text-muted-foreground"
                    }
                  >
                    {row.teacherName}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.groupNames.join(", ")} · {row.expected} student
                    {row.expected === 1 ? "" : "s"}
                  </p>
                </div>
                <Gap
                  label="Attendance"
                  done={row.attendance.marked}
                  total={row.expected}
                  missing={row.attendance.missing}
                  pendingNote={
                    row.attendance.notDueYet > 0
                      ? `${row.attendance.notDueYet} not due yet`
                      : null
                  }
                  href="/attendance"
                />
                <Gap
                  label="Quran"
                  done={row.quran.logged}
                  total={row.quran.expected}
                  missing={row.quran.missing}
                  href="/quran"
                />
                <div className="md:text-right">
                  <StatusBadge
                    status={row.complete ? "Done" : "Outstanding"}
                    tone={row.complete ? "success" : "warning"}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
