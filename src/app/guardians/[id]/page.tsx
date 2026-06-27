import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, Users } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireRole } from "@/lib/auth/current-profile";
import { studentName, type Guardian, type Student } from "@/lib/people/people";
import { createClient } from "@/lib/supabase/server";
import { GuardianLogin } from "./guardian-login";

type ChildLink = {
  relationship: string | null;
  is_primary: boolean;
  student: Pick<Student, "id" | "first_name" | "last_name" | "grade_level">;
};

export default async function GuardianDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireRole(["admin"]);
  const { id } = await params;

  const supabase = await createClient();
  const { data: guardian } = await supabase
    .from("guardians")
    .select("id, full_name, phone, email, user_id, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!guardian) notFound();
  const g = guardian as Guardian;

  const { data: links } = await supabase
    .from("student_guardians")
    .select(
      "relationship, is_primary, students(id, first_name, last_name, grade_level)",
    )
    .eq("guardian_id", id);

  const children: ChildLink[] = (links ?? []).map((row) => ({
    relationship: row.relationship,
    is_primary: row.is_primary,
    student: row.students as unknown as ChildLink["student"],
  }));

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-4xl space-y-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link href="/guardians">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to guardians
          </Link>
        </Button>

        <PageHeader
          title={g.full_name}
          description={g.phone}
          action={
            <Button asChild variant="outline" className="h-10">
              <Link href={`/guardians/${g.id}/edit`}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </Link>
            </Button>
          }
        />

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>Linked children</CardTitle>
            <CardDescription>
              Manage links from each student&apos;s page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {children.length === 0 ? (
              <EmptyState
                title="No children linked"
                description="Open a student and use the Guardians section to link this guardian."
                icon={Users}
              />
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {children.map((c) => (
                  <li
                    key={c.student.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/students/${c.student.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {studentName(c.student)}
                        </Link>
                        {c.is_primary ? (
                          <StatusBadge status="Primary" tone="success" />
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {c.relationship ?? "Guardian"}
                        {c.student.grade_level
                          ? ` · ${c.student.grade_level}`
                          : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>Web login</CardTitle>
            <CardDescription>
              Optional parent access. Most guardians are reached by SMS only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GuardianLogin
              guardianId={g.id}
              hasLogin={Boolean(g.user_id)}
              email={g.email}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
