import { CreditCard, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/controlpad/app-shell";
import { DataTable } from "@/components/controlpad/data-table";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { studentName, type Student } from "@/lib/people/people";
import { createClient } from "@/lib/supabase/server";

import { setPaymentStatus } from "./actions";

// ---------------------------------------------------------------------------
// Month helpers
// ---------------------------------------------------------------------------

function parseMonthParam(
  monthParam: string | undefined,
): { year: number; month: number } {
  if (monthParam) {
    const match = monthParam.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      if (month >= 1 && month <= 12) return { year, month };
    }
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function toPeriodMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toDisplayMonth(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function toMonthParam(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

// ---------------------------------------------------------------------------
// Payment row type
// ---------------------------------------------------------------------------

type PaymentRow = {
  student_id: string;
  period_month: string;
  status: "paid" | "unpaid";
  paid_at: string | null;
  recorded_by: string | null;
};

type TuitionRow = {
  student: Student;
  payment: PaymentRow | null;
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function TuitionPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const profile = await getCurrentProfile();

  if (profile.role !== "admin" && profile.role !== "parent") {
    redirect("/");
  }

  const params = await searchParams;
  const { year, month } = parseMonthParam(params.month);
  const periodMonthStr = toPeriodMonth(year, month);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const isCurrentOrFuture =
    year > currentYear || (year === currentYear && month >= currentMonth);

  const supabase = await createClient();

  // Fetch active students (RLS filters to linked children for parents)
  const { data: studentData } = await supabase
    .from("students")
    .select(
      "id, first_name, last_name, date_of_birth, grade_level, enrollment_status, gcvs_reference, created_at, updated_at",
    )
    .eq("enrollment_status", "active")
    .order("last_name", { ascending: true });

  const students = (studentData ?? []) as Student[];
  const studentIds = students.map((s) => s.id);

  // Fetch payment rows for the selected month
  const { data: paymentData } =
    studentIds.length > 0
      ? await supabase
          .from("payments")
          .select("student_id, period_month, status, paid_at, recorded_by")
          .in("student_id", studentIds)
          .eq("period_month", periodMonthStr)
      : { data: [] };

  const paymentMap = new Map<string, PaymentRow>();
  for (const row of (paymentData ?? []) as PaymentRow[]) {
    paymentMap.set(row.student_id, row);
  }

  const rows: TuitionRow[] = students.map((s) => ({
    student: s,
    payment: paymentMap.get(s.id) ?? null,
  }));

  // ---------------------------------------------------------------------------
  // Admin view
  // ---------------------------------------------------------------------------

  if (profile.role === "admin") {
    const prevMonth = shiftMonth(year, month, -1);
    const nextMonth = shiftMonth(year, month, 1);
    const nextIsDisabled = isCurrentOrFuture;

    return (
      <AppShell fullName={profile.fullName} role={profile.role}>
        <div className="mx-auto max-w-5xl space-y-6">
          <PageHeader
            title="Tuition"
            description="Mark each student's monthly payment status."
          />

          {/* Month navigation */}
          <div className="flex items-center justify-between">
            <Link
              href={`/tuition?month=${toMonthParam(prevMonth.year, prevMonth.month)}`}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="sr-only">Previous month</span>
            </Link>

            <p className="font-semibold">{toDisplayMonth(year, month)}</p>

            {nextIsDisabled ? (
              <span className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground/40 cursor-not-allowed">
                <span className="sr-only">Next month</span>
                <ChevronRight className="h-4 w-4" />
              </span>
            ) : (
              <Link
                href={`/tuition?month=${toMonthParam(nextMonth.year, nextMonth.month)}`}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <span className="sr-only">Next month</span>
                <ChevronRight className="h-4 w-4" />
              </Link>
            )}
          </div>

          <DataTable
            data={rows}
            getRowKey={(row) => row.student.id}
            empty={
              <EmptyState
                title="No active students"
                description="Enroll students to start tracking tuition payments."
                icon={CreditCard}
              />
            }
            columns={[
              {
                key: "student",
                header: "Student",
                cell: (row) => (
                  <span className="font-medium">
                    {studentName(row.student)}
                  </span>
                ),
              },
              {
                key: "fee",
                header: "Monthly fee",
                cell: () => <span className="text-muted-foreground">—</span>,
              },
              {
                key: "status",
                header: "Status",
                cell: (row) => {
                  const isPaid = row.payment?.status === "paid";
                  return isPaid ? (
                    <StatusBadge status="Paid" tone="success" />
                  ) : (
                    <StatusBadge status="Unpaid" tone="danger" />
                  );
                },
              },
              {
                key: "action",
                header: "Action",
                cell: (row) => {
                  const isPaid = row.payment?.status === "paid";
                  const newStatus = isPaid ? "unpaid" : "paid";
                  const label = isPaid ? "Mark unpaid" : "Mark paid";
                  const action = setPaymentStatus.bind(
                    null,
                    row.student.id,
                    periodMonthStr,
                  ) as unknown as (formData: FormData) => Promise<void>;
                  return (
                    <form action={action}>
                      <input type="hidden" name="newStatus" value={newStatus} />
                      <Button type="submit" size="sm" variant="outline">
                        {label}
                      </Button>
                    </form>
                  );
                },
              },
            ]}
          />
        </div>
      </AppShell>
    );
  }

  // ---------------------------------------------------------------------------
  // Parent view (read-only, current month only)
  // ---------------------------------------------------------------------------

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="Tuition"
          description="Your children's payment status."
        />

        <DataTable
          data={rows}
          getRowKey={(row) => row.student.id}
          empty={
            <EmptyState
              title="No children found"
              description="No linked students were found on your account. Contact the school if this is unexpected."
              icon={CreditCard}
            />
          }
          columns={[
            {
              key: "student",
              header: "Student",
              cell: (row) => (
                <span className="font-medium">{studentName(row.student)}</span>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: (row) => {
                const isPaid = row.payment?.status === "paid";
                return isPaid ? (
                  <StatusBadge status="Paid" tone="success" />
                ) : (
                  <StatusBadge status="Unpaid" tone="danger" />
                );
              },
            },
          ]}
        />

        <p className="text-sm text-muted-foreground mt-2">
          Contact the school to update your payment status.
        </p>
      </div>
    </AppShell>
  );
}
