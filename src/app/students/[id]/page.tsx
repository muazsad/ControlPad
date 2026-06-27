import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { PageHeader } from "@/components/controlpad/page-header";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireRole } from "@/lib/auth/current-profile";
import {
  enrollmentBadgeTone,
  studentName,
  type Guardian,
  type Student,
} from "@/lib/people/people";
import { createClient } from "@/lib/supabase/server";
import {
  StudentGuardianLinks,
  type LinkedGuardian,
} from "./student-guardian-links";

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm">{value ?? "—"}</dd>
    </div>
  );
}

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireRole(["admin", "moderator"]);
  const { id } = await params;
  const isAdmin = profile.role === "admin";

  const supabase = await createClient();

  const { data: student } = await supabase
    .from("students")
    .select(
      "id, first_name, last_name, date_of_birth, grade_level, enrollment_status, gcvs_reference, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!student) notFound();
  const s = student as Student;

  const { data: links } = await supabase
    .from("student_guardians")
    .select(
      "relationship, is_primary, guardians(id, full_name, phone, email, user_id, created_at)",
    )
    .eq("student_id", id);

  const linked: LinkedGuardian[] = (links ?? []).map((row) => {
    const g = row.guardians as unknown as Guardian;
    return { ...g, relationship: row.relationship, is_primary: row.is_primary };
  });

  // Only admins can create links, so only they need the candidate list.
  let available: Guardian[] = [];
  if (isAdmin) {
    const { data: allGuardians } = await supabase
      .from("guardians")
      .select("id, full_name, phone, email, user_id, created_at")
      .order("full_name", { ascending: true });
    const linkedIds = new Set(linked.map((g) => g.id));
    available = ((allGuardians ?? []) as Guardian[]).filter(
      (g) => !linkedIds.has(g.id),
    );
  }

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-4xl space-y-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link href="/students">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to students
          </Link>
        </Button>

        <PageHeader
          title={studentName(s)}
          description={s.grade_level ? `Grade: ${s.grade_level}` : undefined}
          action={
            <Button asChild variant="outline" className="h-10">
              <Link href={`/students/${s.id}/edit`}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </Link>
            </Button>
          }
        />

        <Card className="border shadow-sm">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle>Profile</CardTitle>
            <StatusBadge
              status={s.enrollment_status}
              tone={enrollmentBadgeTone(s.enrollment_status)}
              className="capitalize"
            />
          </CardHeader>
          <CardContent>
            <dl className="grid gap-5 sm:grid-cols-2">
              <Detail label="First name" value={s.first_name} />
              <Detail label="Last name" value={s.last_name} />
              <Detail label="Date of birth" value={s.date_of_birth} />
              <Detail label="Grade level" value={s.grade_level} />
              <Detail label="GCVS reference" value={s.gcvs_reference} />
              <Detail
                label="Enrollment"
                value={s.enrollment_status}
              />
            </dl>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>Guardians</CardTitle>
          </CardHeader>
          <CardContent>
            <StudentGuardianLinks
              studentId={s.id}
              linked={linked}
              available={available}
              canManage={isAdmin}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
