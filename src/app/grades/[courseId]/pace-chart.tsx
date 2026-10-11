"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type PacePoint = {
  /** Milliseconds (UTC midnight of the Eastern date). */
  t: number;
  expected?: number;
  actual?: number;
};

// Hex values: recharts can't read CSS variables (see top-performers).
const ACTUAL_COLOR = "#1E2A5E";
const EXPECTED_COLOR = "#C8922E";

const dateLabel = (t: number) =>
  new Date(t).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });

export function PaceChart({ points }: { points: PacePoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={dateLabel}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            domain={[0, 100]}
            unit="%"
            tick={{ fontSize: 12 }}
            width={48}
          />
          <Tooltip
            labelFormatter={(value) => dateLabel(Number(value))}
            formatter={(value, name) => [`${Math.round(Number(value))}%`, name]}
          />
          <Legend />
          <Line
            name="Expected pace"
            dataKey="expected"
            stroke={EXPECTED_COLOR}
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            name="% complete"
            dataKey="actual"
            stroke={ACTUAL_COLOR}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
