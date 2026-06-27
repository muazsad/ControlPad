import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { PageHeader } from "@/components/controlpad/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/current-profile";
import type { Guardian } from "@/lib/people/people";
import { createClient } from "@/lib/supabase/server";
import { updateGuardian } from "../../actions";
import { GuardianForm } from "../../guardian-form";

export default async function EditGuardianPage({
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

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-3xl space-y-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link href={`/guardians/${g.id}`}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to {g.full_name}
          </Link>
        </Button>
        <PageHeader title={`Edit ${g.full_name}`} />
        <Card className="border shadow-sm">
          <CardContent className="pt-6">
            <GuardianForm
              action={updateGuardian}
              guardian={g}
              submitLabel="Save changes"
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
