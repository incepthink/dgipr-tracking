import { cn } from "@/lib/utils";

/**
 * A word-sized trend: one 2px line on a shared baseline, broken where nothing was reported (null) rather than
 * dropped to zero, with the last point dotted. Purely decorative; the figure beside it carries the number, and
 * `label` gives screen readers the series.
 */
export function Sparkline({ values, width = 104, height = 30, label, className }: {
  values: (number | null)[]; width?: number; height?: number; label?: string; className?: string;
}) {
  const nums = values.filter((v): v is number => v !== null);
  if (values.length < 2 || !nums.length) return <span className={cn("inline-block", className)} style={{ width, height }} aria-hidden />;
  const max = Math.max(1, ...nums);
  const pad = 3;
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (values.length - 1);
  const y = (v: number) => height - pad - (v / max) * (height - 2 * pad);
  const runs: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v === null) { if (cur.length) runs.push(cur.join(" ")); cur = []; return; }
    cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length) runs.push(cur.join(" "));
  const lastI = values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).at(-1)!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("shrink-0 overflow-visible", className)}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} className="stroke-r-line" strokeWidth={1} />
      {runs.map((pts, i) => pts.includes(" ")
        ? <polyline key={i} points={pts} fill="none" className="stroke-r-action" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        : <circle key={i} cx={pts.split(",")[0]} cy={pts.split(",")[1]} r={1.5} className="fill-r-action" />)}
      <circle cx={x(lastI)} cy={y(values[lastI] as number)} r={3} className="fill-r-action stroke-r-card" strokeWidth={1.5} />
    </svg>
  );
}
