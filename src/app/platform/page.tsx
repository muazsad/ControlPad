import { BrandMark } from "@/components/controlpad/brand";
import { DataTable } from "@/components/controlpad/data-table";
import { PageHeader } from "@/components/controlpad/page-header";
import { StatusBadge, type StatusTone } from "@/components/controlpad/status-badge";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { listPlatformSchools, type PlatformSchool } from "@/lib/schools/platform-data";

import { ApproveButton } from "./approve-button";

export const dynamic = "force-dynamic";

function textingState(school: PlatformSchool): { label: string; tone: StatusTone } {
  if (!school.textingVerified) return { label: "Not set up", tone: "neutral" };
  if (school.liveApproved) return { label: "Live approved", tone: "success" };
  if (school.requestedMode === "live") return { label: "Waiting for approval", tone: "warning" };
  return { label: school.requestedMode === "test" ? "Test" : "Off", tone: "neutral" };
}

export default async function PlatformPage() {
  await requirePlatformAdmin();
  const schools = await listPlatformSchools();

  return (
    <div className="min-h-dvh bg-background px-4 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="text-primary">
          <BrandMark />
        </div>
        <PageHeader
          title="Schools"
          description="Every school on ControlPad. Approve live texting once a school's Twilio number is registered (A2P / toll-free verification)."
        />
        <DataTable
          data={schools}
          getRowKey={(school) => school.id}
          empty={<p className="text-sm text-muted-foreground">No schools yet.</p>}
          columns={[
            { key: "name", header: "School", cell: (school) => <span className="font-medium">{school.name}</span> },
            {
              key: "created",
              header: "Created",
              cell: (school) => new Date(school.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" }),
            },
            { key: "staff", header: "Staff", cell: (school) => school.staff },
            { key: "students", header: "Active students", cell: (school) => school.students },
            {
              key: "texting",
              header: "Texting",
              cell: (school) => {
                const state = textingState(school);
                return <StatusBadge status={state.label} tone={state.tone} />;
              },
            },
            {
              key: "action",
              header: "",
              cell: (school) =>
                school.textingVerified ? (
                  <ApproveButton schoolId={school.id} approved={school.liveApproved} />
                ) : null,
            },
          ]}
        />
      </div>
    </div>
  );
}
