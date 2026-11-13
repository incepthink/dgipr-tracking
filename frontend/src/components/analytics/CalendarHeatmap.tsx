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
  const loc = lang === "mr" ? "mr-IN" : "en-IN";
  // one heading per month over its days ("ऑक्टोबर 2026 · नोव्हेंबर 2026")
  const months = React.useMemo(() => {
    const out: { key: string; label: string; span: number }[] = [];
    data.periods.forEach((ps) => {
      const key = ps.slice(0, 7);
      const last = out[out.length - 1];
      if (last?.key === key) last.span += 1;
      else out.push({ key, span: 1, label: new Date(ps + "T00:00:00").toLocaleDateString(loc, { month: "long", year: "numeric" }) });
    });
    return out;
  }, [data.periods, loc]);
  return (
    <div className="flex flex-col gap-3">
      {/* the key comes first, so the colours are read before the squares */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-r-ground px-3 py-2.5 text-[13px] font-semibold text-r-ink">
        <span className="flex items-center gap-1.5">
          <span className="text-r-muted">{t("hm_less")}</span>
          <span className="flex gap-0.5">{SEQ.slice(1).map((c) => <span key={c} className={cn("size-4 rounded-[3px]", c)} />)}</span>
          <span className="text-r-muted">{t("hm_more")}</span>
        </span>
        <span className="flex items-center gap-1.5"><span className="size-4 rounded-[3px] border-[1.5px] border-r-field bg-r-card" />{t("hm_zero")}</span>
        <span className="flex items-center gap-1.5"><span className={cn("size-4 rounded-[3px]", HATCH)} />{t("map_not_reported")}</span>
        <span className="flex items-center gap-1.5"><span className="size-4 rounded-[3px] bg-r-card ring-2 ring-r-late ring-inset" />{t("late")}</span>
        <span className="flex items-center gap-1.5"><span className="flex size-4 items-center justify-center"><span className="size-1.5 rounded-full bg-r-faint" /></span>{t("hm_not_due")}</span>
      </div>
      <div ref={box} className="overflow-x-auto scrollbar-thin">
        <table className="border-separate border-spacing-[2px] text-[12px]" aria-label={`${t("hm_title")} · ${metricLabel}`}>
          <thead>
            <tr>
              <th rowSpan={2} scope="col" className="sticky left-0 z-10 w-[124px] min-w-[124px] bg-r-card pr-2 align-bottom text-left text-xs font-bold text-r-muted sm:w-[204px] sm:min-w-[204px]">{t("office")}</th>
              {months.map((m) => (
                <th key={m.key} colSpan={m.span} scope="colgroup"
                  className="border-b-2 border-r-line px-0 pb-0.5 text-left text-[12px] font-bold whitespace-nowrap text-r-ink">
                  <span className="sticky left-[128px] inline-block px-1 sm:left-[208px]">{m.label}</span>
                </th>
              ))}
            </tr>
            <tr>
              {data.periods.map((ps) => {
                const d = new Date(ps + "T00:00:00");
                const sunday = d.getDay() === 0;
                return (
                  <th key={ps} scope="col" title={dayMonth(ps, lang)}
                    className={cn("num w-6 min-w-6 px-0 pt-1 text-center leading-tight font-bold", sunday ? "text-r-overdue-ink" : "text-r-muted")}>
                    <span className="block text-[9px] font-semibold">{d.toLocaleDateString(loc, { weekday: "narrow" })}</span>
                    <span className="block text-[11px]">{d.getDate()}</span>
                  </th>
                );
              })}
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
                    <th scope="row" title={name(r)} className="sticky left-0 z-10 w-[124px] max-w-[124px] truncate bg-r-card pr-2 text-left font-medium whitespace-nowrap sm:w-[204px] sm:max-w-[204px]">{name(r)}</th>
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
                              : c.due ? HATCH : "mx-auto mt-2.5 size-1.5! rounded-full bg-r-faint",
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
    </div>
  );
}
