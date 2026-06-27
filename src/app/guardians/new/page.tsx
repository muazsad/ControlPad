import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { PageHeader } from "@/components/controlpad/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/current-profile";
import { createGuardian } from "../actions";
import { GuardianForm } from "../guardian-form";

export default async function NewGuardianPage() {
  const profile = await requireRole(["admin"]);

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-3xl space-y-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link href="/guardians">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to guardians
          </Link>
        </Button>
        <PageHeader
          title="New guardian"
          description="Add a parent or guardian contact. You can link students and enable a login afterwards."
        />
        <Card className="border shadow-sm">
          <CardContent className="pt-6">
            <GuardianForm action={createGuardian} submitLabel="Create guardian" />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
