import { cn } from "@/lib/utils";
import { deltaPct, fig } from "@/components/reports/period";

/** One field group's total for the range and its change on the range before. The day-by-day sparkline was taken out
 * (Nov 2026): with a few days it drew stray dots that read as noise; the trend chart below shows the days. `series` is
 * still accepted so callers need not change. */
export function GroupTile({ label, total, previous, comparable, selected, onClick, sub }: {
  label: string; total: number; previous: number; comparable: boolean; series?: (number | null)[];
  selected?: boolean; onClick?: () => void; sub?: string;
}) {
  const d = comparable ? deltaPct(total, previous) : { text: "—", dir: 0 };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} aria-pressed={onClick ? !!selected : undefined} onClick={onClick}
      className={cn("flex min-w-0 flex-col gap-1 rounded-xl px-3.5 py-3 text-left text-r-ink",
        onClick && "cursor-pointer", selected ? "border-2 border-r-action bg-r-action-soft" : "border-[1.5px] border-r-sunk bg-r-card hover:border-r-line")}>
      <span className="text-[13px] font-bold text-r-muted">{label}</span>
      <span className="flex items-baseline gap-2">
        <b className="disp num text-[28px] leading-none">{fig(total)}</b>
        <span className={cn("num text-[13px] font-semibold", d.dir > 0 ? "text-r-accepted" : d.dir < 0 ? "text-r-overdue-ink" : "text-r-muted")}>{d.text}</span>
      </span>
      {sub && <span className="text-xs text-r-muted">{sub}</span>}
    </Tag>
  );
}
