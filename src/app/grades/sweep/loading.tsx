import { AppShell } from "@/components/controlpad/app-shell";
import { TableSkeleton } from "@/components/controlpad/loading-patterns";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentProfile } from "@/lib/auth/current-profile";

export default async function Loading() {
  const profile = await getCurrentProfile();

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-6xl space-y-6">
        <Skeleton className="h-10 w-72" />
        <TableSkeleton rows={10} />
      </div>
    </AppShell>
  );
}
