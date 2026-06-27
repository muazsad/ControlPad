import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { PageHeader } from "@/components/controlpad/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/current-profile";
import { studentName, type Student } from "@/lib/people/people";
import { createClient } from "@/lib/supabase/server";
import { updateStudent } from "../../actions";
import { StudentForm } from "../../student-form";

export default async function EditStudentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireRole(["admin", "moderator"]);
  const { id } = await params;

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

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-3xl space-y-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link href={`/students/${s.id}`}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to {studentName(s)}
          </Link>
        </Button>
        <PageHeader title={`Edit ${studentName(s)}`} />
        <Card className="border shadow-sm">
          <CardContent className="pt-6">
            <StudentForm
              action={updateStudent}
              student={s}
              submitLabel="Save changes"
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
