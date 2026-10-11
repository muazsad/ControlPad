import { cn } from "@/lib/utils";

type SparklineProps = {
  /** Values oldest to newest (e.g. grades 0–100). */
  points: number[];
  tone?: "success" | "warning" | "danger" | "neutral";
  className?: string;
};

const strokeClasses = {
  success: "stroke-status-success",
  warning: "stroke-status-warning",
  danger: "stroke-status-danger",
  neutral: "stroke-status-neutral",
};

const WIDTH = 72;
const HEIGHT = 24;
const PAD = 3;

/** Tiny inline trend line. Decorative: the numbers are always shown next to it. */
export function Sparkline({ points, tone = "neutral", className }: SparklineProps) {
  if (points.length === 0) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const x = (index: number) =>
    points.length === 1
      ? WIDTH / 2
      : PAD + (index / (points.length - 1)) * (WIDTH - PAD * 2);
  const y = (value: number) =>
    HEIGHT - PAD - ((value - min) / range) * (HEIGHT - PAD * 2);
  const path = points.map((value, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(value)}`).join(" ");
  const lastIndex = points.length - 1;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      {points.length > 1 ? (
        <path
          d={path}
          fill="none"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={strokeClasses[tone]}
        />
      ) : null}
      <circle
        cx={x(lastIndex)}
        cy={y(points[lastIndex])}
        r={2.25}
        className={cn("fill-current", strokeClasses[tone].replace("stroke-", "text-"))}
      />
    </svg>
  );
}
