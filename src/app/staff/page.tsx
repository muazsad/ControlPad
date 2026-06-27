import { ShieldCheck } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { DataTable } from "@/components/controlpad/data-table";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { StatusBadge } from "@/components/controlpad/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireRole } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { CreateModeratorForm } from "./create-moderator-form";

type StaffProfile = {
  id: string;
  full_name: string;
  role: "admin" | "moderator" | "parent";
  phone: string | null;
  created_at: string;
};

export default async function StaffPage() {
  const profile = await requireRole(["admin"]);

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role, phone, created_at")
    .in("role", ["admin", "moderator"])
    .order("role", { ascending: true });

  const staff = (data ?? []) as StaffProfile[];

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader
          title="Staff"
          description="Administrators and moderators who can sign in to ControlPad."
        />

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>Team</CardTitle>
            <CardDescription>
              Moderators can view students and edit grades, attendance, and
              Quran progress. They cannot manage billing or settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              data={staff}
              getRowKey={(row) => row.id}
              empty={
                <EmptyState
                  title="No staff yet"
                  description="Create the first moderator below."
                  icon={ShieldCheck}
                />
              }
              columns={[
                {
                  key: "name",
                  header: "Name",
                  cell: (row) => (
                    <span className="font-medium">{row.full_name}</span>
                  ),
                },
                {
                  key: "role",
                  header: "Role",
                  cell: (row) => (
                    <StatusBadge
                      status={row.role}
                      tone={row.role === "admin" ? "success" : "neutral"}
                      className="capitalize"
                    />
                  ),
                },
                {
                  key: "phone",
                  header: "Phone",
                  cell: (row) => row.phone ?? "—",
                  className: "text-muted-foreground",
                },
              ]}
            />
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>Create moderator account</CardTitle>
            <CardDescription>
              Sets a temporary password (no email invite required). Share it
              securely; the moderator can change it after signing in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateModeratorForm />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
