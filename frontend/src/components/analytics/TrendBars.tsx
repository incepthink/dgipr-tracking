import type * as React from "react";
import type { FormField, SeriesPoint } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RCard, RCardTitle } from "@/components/reports/kit";
import { dayMonth, fig } from "@/components/reports/period";
import { fieldLabel } from "@/pages/forms/common";

/** Bars for the chosen range (sum of `keys`), with a line for the same position in the previous range. A day with
 * nothing entered is a dashed outline, never a zero bar; a day still in progress is hatched. */
export function TrendBars({ data, prev, keys, title, rangeLabel, actions }: {
  data?: SeriesPoint[]; prev?: SeriesPoint[]; keys: string[]; title: string; rangeLabel: string; actions?: React.ReactNode;
}) {
  const { t, lang } = useT();
  const rows = data ?? [];
  const val = (p: SeriesPoint) => keys.reduce((a, k) => a + (p.values[k] ?? 0), 0);
  const max = Math.max(1, ...rows.map(val), ...(prev ?? []).map(val));
  const top = nice(max);
  const H = 220;
  const ticks = [1, 2 / 3, 1 / 3, 0].map((x) => Math.round(top * x));
  const many = rows.length > 21;
  return (
    <RCard>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <RCardTitle>{title}</RCardTitle>
        <div className="flex flex-wrap items-center gap-4 text-[13px] text-r-muted">
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-r-action" />{rangeLabel}</span>
          {prev && <span className="flex items-center gap-1.5"><span className="h-0 w-3.5 border-t-2 border-r-muted" />{t("previous_period")}</span>}
          {actions}
        </div>
      </div>
      {!data ? <div className="h-64 animate-pulse rounded-lg bg-r-sunk" /> : !rows.length ? <p className="m-0 text-r-muted">{t("no_data_range")}</p> : (
        <div role="img" aria-label={`${title}: ${rows.map((p) => `${dayMonth(p.date, lang)} ${p.entered_cells ? fig(val(p)) : t("not_counted")}`).join(", ")}`} className="flex gap-2.5">
          <div aria-hidden className="num flex w-12 flex-col justify-between text-right text-[11px] text-r-muted" style={{ height: H }}>
            {ticks.map((x, i) => <span key={i} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">{fig(x)}</span>)}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="relative flex items-end gap-[3px] border-b-[1.5px] border-r-ink sm:gap-2"
              style={{ height: H, background: `linear-gradient(var(--r-sunk) 1px, transparent 1px) 0 0 / 100% ${H / 3}px` }}>
              {rows.map((p, i) => {
                const v = val(p);
                const pv = prev?.[i] ? val(prev[i]) : undefined;
                const partial = p.entered_cells < p.expected_cells && i === rows.length - 1;
                return (
                  <div key={p.date} tabIndex={0} className="group relative flex h-full flex-1 items-end outline-none">
                    {p.entered_cells ? (
                      <div className={cn("w-full rounded-t", partial ? "bg-[repeating-linear-gradient(135deg,var(--r-action)_0_3px,var(--r-action-soft)_3px_7px)]" : "bg-r-action", "group-hover:opacity-85")}
                        style={{ height: Math.max(2, (v / top) * H) }} />
                    ) : (
                      <div className="w-full rounded-t border-[1.5px] border-b-0 border-dashed border-r-faint" style={{ height: 24 }} />
                    )}
                    {pv !== undefined && <div aria-hidden className="absolute -inset-x-0.5 border-t-2 border-r-muted shadow-[0_0_0_1px_var(--r-card)]" style={{ bottom: (pv / top) * H }} />}
                    <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md bg-r-ink px-2 py-1 text-xs whitespace-nowrap text-r-card group-hover:block group-focus-visible:block">
                      {dayMonth(p.date, lang)}: <b className="num">{p.entered_cells ? fig(v) : t("not_counted")}</b>{partial && ` (${t("so_far")})`}
                      {pv !== undefined && <> · {t("previous_period")}: <span className="num">{fig(pv)}</span></>}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-[3px] sm:gap-2" aria-hidden>
              {rows.map((p, i) => (
                <span key={p.date} className="num flex-1 text-center text-[11px] text-r-muted">
                  {!many || i % Math.ceil(rows.length / 12) === 0 ? new Date(p.date + "T00:00:00").getDate() : ""}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </RCard>
  );
}

/** The same series as a table: one row per day, one column per field; nothing entered shows —, a confirmed 0 shows 0. */
export function SeriesTable({ data, cols }: { data: SeriesPoint[]; cols: FormField[] }) {
  const { t, lang } = useT();
  return (
    <RCard className="p-0">
      <div className="max-h-[60vh] overflow-auto rounded-2xl scrollbar-thin">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-20 border-b border-r-line bg-r-card px-3 py-2 text-left text-xs font-bold text-r-muted">{t("date")}</th>
              {cols.map((c) => <th key={c.key} className="border-b border-r-line bg-r-card px-2 py-2 text-right align-bottom text-xs leading-tight font-bold text-r-muted">{fieldLabel(c, lang)}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.date} className="hover:bg-r-ground">
                <th className="sticky left-0 border-b border-r-line-soft bg-r-card px-3 py-1.5 text-left font-medium whitespace-nowrap">{dayMonth(p.date, lang)}</th>
                {cols.map((c) => (
                  <td key={c.key} className="num border-b border-r-line-soft px-2 py-1.5 text-right">
                    {(p.entered ? p.entered[c.key] : p.entered_cells) ? fig(p.values[c.key]) : <span className="text-r-faint">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RCard>
  );
}

export function nice(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return v;
}
