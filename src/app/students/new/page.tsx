import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { PageHeader } from "@/components/controlpad/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/current-profile";
import { createStudent } from "../actions";
import { StudentForm } from "../student-form";

export default async function NewStudentPage() {
  const profile = await requireRole(["admin", "moderator"]);

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-3xl space-y-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link href="/students">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to students
          </Link>
        </Button>
        <PageHeader
          title="New student"
          description="Create a student record. You can link guardians after saving."
        />
        <Card className="border shadow-sm">
          <CardContent className="pt-6">
            <StudentForm action={createStudent} submitLabel="Create student" />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
