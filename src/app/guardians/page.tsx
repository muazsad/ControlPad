import Link from "next/link";
import { Contact, Plus } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { DataTable } from "@/components/controlpad/data-table";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/current-profile";
import type { Guardian } from "@/lib/people/people";
import { createClient } from "@/lib/supabase/server";

export default async function GuardiansPage() {
  // Admin: full management. Moderator: read-only (per access matrix).
  const profile = await requireRole(["admin", "moderator"]);
  const isAdmin = profile.role === "admin";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("guardians")
    .select("id, full_name, phone, email, user_id, created_at")
    .order("full_name", { ascending: true });

  const guardians = (data ?? []) as Guardian[];

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title="Guardians"
          description={
            isAdmin
              ? "Parent and guardian contacts. Link them to students and optionally enable a web login."
              : "Parent and guardian contacts (read-only)."
          }
          action={
            isAdmin ? (
              <Button asChild className="h-10">
                <Link href="/guardians/new">
                  <Plus className="size-4" aria-hidden="true" />
                  New guardian
                </Link>
              </Button>
            ) : undefined
          }
        />

        {error ? (
          <EmptyState
            title="Could not load guardians"
            description={error.message}
            icon={Contact}
          />
        ) : (
          <DataTable
            data={guardians}
            getRowKey={(row) => row.id}
            empty={
              <EmptyState
                title="No guardians yet"
                description={
                  isAdmin
                    ? "Add a guardian to start linking families to students."
                    : "No guardian records have been added yet."
                }
                icon={Contact}
              />
            }
            columns={[
              {
                key: "name",
                header: "Name",
                cell: (row) =>
                  isAdmin ? (
                    <Link
                      href={`/guardians/${row.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {row.full_name}
                    </Link>
                  ) : (
                    <span className="font-medium">{row.full_name}</span>
                  ),
              },
              { key: "phone", header: "Phone", cell: (row) => row.phone },
              {
                key: "email",
                header: "Email",
                cell: (row) => row.email ?? "—",
                className: "text-muted-foreground",
              },
              {
                key: "login",
                header: "Login",
                cell: (row) =>
                  row.user_id ? (
                    <StatusBadge status="Enabled" tone="success" />
                  ) : (
                    <StatusBadge status="None" tone="neutral" />
                  ),
              },
            ]}
          />
        )}
      </div>
    </AppShell>
  );
}
