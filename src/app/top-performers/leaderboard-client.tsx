"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { compositeScore, performanceTone } from "@/lib/people/performance";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

export type StudentSubScores = {
  id: string;
  name: string;
  grade_level: string | null;
  gradeScore: number | null;
  quranScore: number;
  attRate: number;
};

type FactorKey = "grades" | "quran" | "attendance";

type WeightState = {
  grades: { enabled: boolean; weight: number };
  quran: { enabled: boolean; weight: number };
  attendance: { enabled: boolean; weight: number };
};

// ── Constants ────────────────────────────────────────────────────────────────

const LS_KEY = "leaderboard-weights";

const DEFAULTS: WeightState = {
  grades: { enabled: true, weight: 33 },
  quran: { enabled: true, weight: 33 },
  attendance: { enabled: true, weight: 33 },
};

const PRESETS: Record<string, WeightState> = {
  Balanced: {
    grades: { enabled: true, weight: 33 },
    quran: { enabled: true, weight: 33 },
    attendance: { enabled: true, weight: 33 },
  },
  "Grades-heavy": {
    grades: { enabled: true, weight: 60 },
    quran: { enabled: true, weight: 20 },
    attendance: { enabled: true, weight: 20 },
  },
  "Quran-heavy": {
    grades: { enabled: true, weight: 20 },
    quran: { enabled: true, weight: 60 },
    attendance: { enabled: true, weight: 20 },
  },
  "Attendance-heavy": {
    grades: { enabled: true, weight: 20 },
    quran: { enabled: true, weight: 20 },
    attendance: { enabled: true, weight: 60 },
  },
};

// Maps performanceTone values to chart fill colours (hex; CSS vars not readable by recharts).
const TONE_COLORS: Record<string, string> = {
  success: "#16A34A",
  warning: "#EA8A00",
  danger: "#DC2626",
  neutral: "#94A3B8",
};

const FACTOR_LABELS: Record<FactorKey, string> = {
  grades: "Grades",
  quran: "Quran",
  attendance: "Attendance",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function isPresetActive(ws: WeightState, preset: WeightState): boolean {
  const keys: FactorKey[] = ["grades", "quran", "attendance"];
  return keys.every(
    (k) =>
      ws[k].enabled === preset[k].enabled && ws[k].weight === preset[k].weight,
  );
}

function formatPct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v)}%`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function FactorControl({
  label,
  enabled,
  weight,
  onToggle,
  onWeight,
}: {
  label: string;
  enabled: boolean;
  weight: number;
  onToggle: () => void;
  onWeight: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={enabled}
        className={cn(
          "inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          enabled ? "bg-[var(--color-primary)]" : "bg-muted",
        )}
        aria-label={`Toggle ${label}`}
      >
        <span
          className={cn(
            "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform",
            enabled ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>
      <span className={cn("w-24 text-sm font-medium", !enabled && "text-muted-foreground")}>
        {label}
      </span>
      <input
        type="range"
        min={1}
        max={100}
        value={weight}
        disabled={!enabled}
        onChange={(e) => onWeight(Number(e.target.value))}
        className="h-1.5 w-36 cursor-pointer appearance-none rounded-full bg-muted accent-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={`${label} weight`}
      />
      <span className={cn("w-8 text-right text-sm tabular-nums", !enabled && "text-muted-foreground")}>
        {weight}
      </span>
    </div>
  );
}

// ── Main client component ────────────────────────────────────────────────────

export function LeaderboardClient({ students }: { students: StudentSubScores[] }) {
  const [weights, setWeights] = useState<WeightState>(() => {
    if (typeof window === "undefined") return DEFAULTS;
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) return JSON.parse(stored) as WeightState;
    } catch {
      // ignore malformed storage
    }
    return DEFAULTS;
  });

  // Persist whenever weights change.
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(weights));
    } catch {
      // ignore quota errors
    }
  }, [weights]);

  const updateFactor = (key: FactorKey, patch: Partial<{ enabled: boolean; weight: number }>) => {
    setWeights((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  // Compute composite scores for every student.
  const ranked = useMemo(() => {
    const w = {
      grades: weights.grades.enabled ? weights.grades.weight : 0,
      quran: weights.quran.enabled ? weights.quran.weight : 0,
      attendance: weights.attendance.enabled ? weights.attendance.weight : 0,
    };
    return students
      .map((s) => {
        const score = compositeScore(w, s.gradeScore, s.quranScore, s.attRate);
        return { ...s, composite: score };
      })
      .sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1));
  }, [students, weights]);

  const chartData = ranked.map((s) => ({
    id: s.id,
    name: s.name,
    composite: s.composite !== null ? Math.round(s.composite) : 0,
    tone: performanceTone(s.composite),
  }));

  const chartHeight = Math.max(280, chartData.length * 44);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Weighting controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Preset buttons */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(PRESETS).map(([label, preset]) => (
              <Button
                key={label}
                size="sm"
                variant={isPresetActive(weights, preset) ? "default" : "outline"}
                onClick={() => setWeights(preset)}
              >
                {label}
              </Button>
            ))}
          </div>

          {/* Per-factor toggle + slider */}
          <div className="space-y-3 pt-1">
            {(["grades", "quran", "attendance"] as FactorKey[]).map((key) => (
              <FactorControl
                key={key}
                label={FACTOR_LABELS[key]}
                enabled={weights[key].enabled}
                weight={weights[key].weight}
                onToggle={() => updateFactor(key, { enabled: !weights[key].enabled })}
                onWeight={(v) => updateFactor(key, { weight: v })}
              />
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Slider values are relative — they are automatically normalised to sum to 1.
            Disabled factors are excluded from the composite entirely.
          </p>
        </CardContent>
      </Card>

      {/* Chart */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Composite scores</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No student data available.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart
                layout="vertical"
                data={chartData}
                margin={{ top: 4, right: 40, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fontSize: 12, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={130}
                  tick={{ fontSize: 12, fill: "#334155" }}
                  tickFormatter={(v: string) =>
                    v.length > 20 ? `${v.slice(0, 19)}…` : v
                  }
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "#f1f5f9" }}
                  formatter={(value) => [`${value}%`, "Composite"]}
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    fontSize: "13px",
                  }}
                />
                <Bar dataKey="composite" radius={[0, 4, 4, 0]} maxBarSize={28}>
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.id}
                      fill={TONE_COLORS[entry.tone] ?? TONE_COLORS.neutral}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Ranked table */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Rankings</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-hidden rounded-b-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/70">
                  <th className="px-4 py-2.5 text-left font-semibold text-foreground w-10">#</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-foreground">Student</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-foreground">Composite</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-foreground">
                    {weights.grades.enabled ? "Grades" : <span className="text-muted-foreground line-through">Grades</span>}
                  </th>
                  <th className="px-4 py-2.5 text-left font-semibold text-foreground">
                    {weights.quran.enabled ? "Quran" : <span className="text-muted-foreground line-through">Quran</span>}
                  </th>
                  <th className="px-4 py-2.5 text-left font-semibold text-foreground">
                    {weights.attendance.enabled ? "Attendance" : <span className="text-muted-foreground line-through">Attendance</span>}
                  </th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((s, i) => (
                  <tr
                    key={s.id}
                    className="border-b last:border-b-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/students/${s.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {s.name}
                      </Link>
                      {s.grade_level && (
                        <p className="text-xs text-muted-foreground">{s.grade_level}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={formatPct(s.composite)}
                        tone={performanceTone(s.composite)}
                      />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {formatPct(s.gradeScore)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {formatPct(s.quranScore)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {formatPct(s.attRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ranked.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No students to rank.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
