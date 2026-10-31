import * as React from "react";
import type { Heatmap } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { dayMonth, fig } from "@/components/reports/period";
import { heatLevels } from "@/components/map/geometry";

const SEQ = ["", "bg-r-seq-1", "bg-r-seq-2", "bg-r-seq-3", "bg-r-seq-4", "bg-r-seq-5"];
const HATCH = "bg-[repeating-linear-gradient(45deg,var(--r-overdue)_0_1.5px,var(--r-overdue-soft)_1.5px_5px)]";

/**
 * The reporting calendar: offices down (official order, division bands), periods across. A reported cell is
 * shaded by its total (quantiles of all reported cells, same ramp as the map); a reported 0 is an empty ringed
 * cell; a due period with nothing sent is hatched; a period not yet due is a dot. Each cell has a tooltip.
 */
export function CalendarHeatmap({ data, metricLabel }: { data: Heatmap; metricLabel: string }) {
  const { t, name, lang } = useT();
  const levels = React.useMemo(() => {
    const m = new Map<string, number | null>();
    data.rows.forEach((r) => r.cells.forEach((c, j) => { if (c.total) m.set(`${r.code}|${j}`, c.total); }));
    return heatLevels(m);
  }, [data]);
  const multiDiv = new Set(data.rows.map((r) => r.division)).size > 1;
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { if (box.current) box.current.scrollLeft = box.current.scrollWidth; }, [data.end]);
  const sent = (s: string) => s === "submitted" || s === "returned";
  return (
    <div className="flex flex-col gap-2">
      <div ref={box} className="overflow-x-auto scrollbar-thin">
        <table className="border-separate border-spacing-[2px] text-[12px]" aria-label={`${t("hm_title")} · ${metricLabel}`}>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-r-card pr-2 text-left text-xs font-bold text-r-muted">{t("office")}</th>
              {data.periods.map((ps) => (
                <th key={ps} scope="col" className="num w-6 min-w-6 text-center text-[10px] font-bold text-r-muted">{new Date(ps + "T00:00:00").getDate()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => {
              const band = multiDiv && (i === 0 || data.rows[i - 1].division !== r.division);
              return (
                <React.Fragment key={r.code}>
                  {band && (
                    <tr><th colSpan={data.periods.length + 1} scope="rowgroup" className="sticky left-0 bg-r-card pt-2 text-left text-xs font-bold text-r-muted">{r.division_mr}</th></tr>
                  )}
                  <tr>
                    <th scope="row" title={name(r)} className="sticky left-0 z-10 max-w-[120px] truncate bg-r-card pr-2 text-left font-medium whitespace-nowrap sm:max-w-[200px]">{name(r)}</th>
                    {r.cells.map((c, j) => {
                      const lvl = levels[`${r.code}|${j}`];
                      const isSent = sent(c.status);
                      const tip = `${name(r)}, ${dayMonth(data.periods[j], lang)}: ` + (isSent
                        ? `${metricLabel} ${c.total === null ? "—" : fig(c.total)}${c.late ? ` · ${t("late")}` : ""}`
                        : c.due ? t("map_not_reported") : t("hm_not_due"));
                      return (
                        <td key={j} title={tip} aria-label={tip} className="p-0">
                          <span className={cn("block size-6 rounded-[4px]",
                            isSent ? (lvl ? SEQ[lvl] : "border-[1.5px] border-r-field bg-r-card")
                              : c.status === "draft" ? "border-[1.5px] border-dashed border-r-muted"
                              : c.due ? HATCH : "mx-auto mt-2.5 size-1.5! rounded-full bg-r-na",
                            c.late && isSent && "ring-2 ring-r-late ring-inset")} />
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-r-muted">
        <span className="flex items-center gap-1.5"><span className="flex">{SEQ.slice(1).map((c) => <span key={c} className={cn("size-3", c)} />)}</span>{t("hm_less_more")}</span>
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border-[1.5px] border-r-field" />{t("hm_zero")}</span>
        <span className="flex items-center gap-1.5"><span className={cn("size-3 rounded-[3px]", HATCH)} />{t("map_not_reported")}</span>
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] ring-2 ring-r-late ring-inset" />{t("late")}</span>
      </div>
    </div>
  );
}
