"use client";

import {
  Area,
  Bar,
  ComposedChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { QuranProgressPoint } from "@/lib/people/quran-progress";

/** A memorization point, plus how many revision entries were logged that day. */
export type QuranChartPoint = Pick<QuranProgressPoint, "date" | "cumulativeLines"> & {
  revisions: number;
};

function formatDate(value: string) {
  const [, month, day] = value.split("-");
  return `${month}/${day}`;
}

export function QuranProgressChart({
  series,
}: {
  series: QuranChartPoint[];
}) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={series}
          margin={{ top: 12, right: 20, left: 0, bottom: 4 }}
        >
          <defs>
            <linearGradient id="quranLinesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 12, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis yAxisId="revisions" orientation="right" hide allowDecimals={false} domain={[0, (max: number) => Math.max(4, max * 4)]} />
          <YAxis
            tick={{ fontSize: 12, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip
            formatter={(value, name) =>
              name === "revisions"
                ? [`${value} entr${Number(value) === 1 ? "y" : "ies"}`, "Revision (sabaq para / dhor)"]
                : [`${value} lines`, name === "cumulativeLines" ? "Memorized (sabaq)" : name]
            }
            labelFormatter={(label) => `Date: ${label}`}
            contentStyle={{
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              fontSize: "13px",
            }}
          />
          <Area
            type="monotone"
            dataKey="cumulativeLines"
            stroke="var(--color-primary)"
            strokeWidth={2.5}
            fill="url(#quranLinesFill)"
            activeDot={{
              r: 4,
              stroke: "var(--color-primary)",
              strokeWidth: 2,
              fill: "var(--color-accent)",
            }}
          />
          <Bar
            dataKey="revisions"
            yAxisId="revisions"
            name="revisions"
            barSize={6}
            fill="var(--color-status-success)"
            fillOpacity={0.6}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
