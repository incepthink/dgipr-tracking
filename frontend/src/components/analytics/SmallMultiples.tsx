import * as React from "react";
import type { Heatmap } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { dayMonth, fig } from "@/components/reports/period";

/**
 * One small bar chart per division (or per office for a zone), all on the same y-scale so heights compare
 * across panels. Built from the heatmap cells: a day's bar is the sum over the division's offices that reported;
 * a day nobody in it reported is a dashed stub, not a zero bar. Under each: total and reporting %.
 */
export function SmallMultiples({ data, byOffice, metricLabel }: { data: Heatmap; byOffice?: boolean; metricLabel: string }) {
  const { t, name, lang } = useT();
  const panels = React.useMemo(() => {
    const m = new Map<string, { key: string; label: string; days: (number | null)[]; sent: number; due: number }>();
    data.rows.forEach((r) => {
      const key = byOffice ? r.code : r.division;
      const p = m.get(key) ?? { key, label: byOffice ? name(r) : r.division_mr, days: data.periods.map(() => null), sent: 0, due: 0 };
      r.cells.forEach((c, j) => {
        const isSent = c.status === "submitted" || c.status === "returned";
        if (isSent) { p.sent++; p.days[j] = (p.days[j] ?? 0) + (c.total ?? 0); }
        if (isSent || c.due) p.due++;
      });
      m.set(key, p);
    });
    return [...m.values()];
  }, [data, byOffice, name]);
  const max = Math.max(1, ...panels.flatMap((p) => p.days.map((v) => v ?? 0)));
  const H = 56;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(200px,100%),1fr))] gap-3">
      {panels.map((p) => {
        const total = p.days.reduce<number>((a, v) => a + (v ?? 0), 0);
        const pct = p.due ? Math.round((100 * p.sent) / p.due) : null;
        return (
          <div key={p.key} className="flex flex-col gap-1.5 rounded-xl border-[1.5px] border-r-sunk p-3">
            <b className="truncate text-sm" title={p.label}>{p.label}</b>
            <div role="img" aria-label={`${p.label}, ${metricLabel}: ${p.days.map((v, j) => `${dayMonth(data.periods[j], lang)} ${v === null ? t("not_counted") : fig(v)}`).join(", ")}`}
              className="flex items-end gap-px border-b border-r-ink" style={{ height: H }}>
              {p.days.map((v, j) => (
                <span key={j} title={`${dayMonth(data.periods[j], lang)}: ${v === null ? t("not_counted") : fig(v)}`}
                  className={cn("flex-1 rounded-t-[2px]", v === null ? "border border-b-0 border-dashed border-r-faint" : "bg-r-action")}
                  style={{ height: v === null ? 8 : Math.max(1.5, (v / max) * H) }} />
              ))}
            </div>
            <span className="flex justify-between text-xs text-r-muted">
              <span className="num"><b className="text-r-ink">{fig(total)}</b> {metricLabel}</span>
              <span className={cn("num font-semibold", pct !== null && pct < 70 && "text-r-overdue-ink")}>{pct === null ? "—" : `${pct}%`} {t("sm_reported")}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
