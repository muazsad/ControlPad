import { AppShell } from "@/components/controlpad/app-shell";
import { PageHeader } from "@/components/controlpad/page-header";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getAllStudentMetrics } from "@/lib/people/student-metrics";
import { LeaderboardClient, type StudentSubScores } from "./leaderboard-client";

export default async function TopPerformersPage() {
  const profile = await getCurrentProfile();
  const metrics = await getAllStudentMetrics();

  // Pass only the serialisable sub-scores the client needs — not the full row.
  const students: StudentSubScores[] = metrics
    .filter((s) => s.globalStatus === "scored")
    .map((s) => ({
      id: s.id,
      name: s.name,
      grade_level: s.grade_level,
      gradeScore: s.gradeScore,
      quranScore: s.quranResult.score,
      attRate: s.attRate,
    }));

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title="Top Performers"
          description="Composite ranking across grades, Quran, and attendance. Weights and toggles apply to this tab only — they do not affect the global performance metric shown elsewhere."
        />
        <LeaderboardClient students={students} />
      </div>
    </AppShell>
  );
}
