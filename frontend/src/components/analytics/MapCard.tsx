import * as React from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import type { MapRow, OfficeMap } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RButton, RCard, RCardTitle, RChip, RSegmented } from "@/components/reports/kit";
import { dayMonth, fig } from "@/components/reports/period";
import { MaharashtraMap, type MapStatus } from "@/components/map/MaharashtraMap";
import { GEO_NAMES, GEO_OFFICE, HQ_GEO, OFFICE_GEO } from "@/components/map/offices";
import { MAP } from "@/components/map/geometry";
import { Sparkline } from "./Sparkline";

export type MapMetric = "reporting" | "field" | "change";

/**
 * The map card: a metric switcher (reporting % by default — it is what someone acts on — the chosen field per
 * reported day, or its change on the range before), the map, the non-district units (विमाका, मुख्यालय) as chips,
 * a table view, and a panel for the clicked district.
 */
export function MapCard({ data, metric, onMetric, fieldLabel, formId, pending }: {
  data?: OfficeMap; metric: MapMetric; onMetric: (m: MapMetric) => void; fieldLabel: string; formId: number; pending?: boolean;
}) {
  const { t, tf, name, lang } = useT();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [asTable, setAsTable] = React.useState(false);
  const rows = React.useMemo(() => data?.rows ?? [], [data]);
  const valueOf = React.useCallback((r: MapRow) => metric === "reporting" ? r.pct : metric === "field" ? r.per_day : r.delta_pct, [metric]);
  const fmt = React.useCallback((n: number) => metric === "field" ? fig(n) : `${metric === "change" && n > 0 ? "+" : ""}${Math.round(n)}%`, [metric]);
  const label = metric === "reporting" ? t("map_m_reporting") : metric === "field" ? tf("map_m_field", { f: fieldLabel }) : tf("map_m_change", { f: fieldLabel });

  const { values, status, names } = React.useMemo(() => {
    const values = new Map<string, number | null>();
    const status = new Map<string, MapStatus>();
    const names: Record<string, string> = {};
    rows.forEach((r) => {
      const g = OFFICE_GEO[r.code];
      if (!g) return;
      values.set(g, valueOf(r));
      status.set(g, r.latest_reported ? "ok" : "missing");
      names[g] = name(r);
    });
    HQ_GEO.forEach((g) => { status.set(g, "hq"); names[g] = `${lang === "en" ? GEO_NAMES[g].en : GEO_NAMES[g].mr} (${t("map_hq_short")})`; });
    return { values, status, names };
  }, [rows, valueOf, name, lang, t]);

  const chips = rows.filter((r) => !OFFICE_GEO[r.code]);
  const sel = selected ? rows.find((r) => r.code === (GEO_OFFICE[selected] ?? selected)) : undefined;
  const onMap = rows.some((r) => OFFICE_GEO[r.code]);

  return (
    <RCard className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <RCardTitle>{t("map_title")}</RCardTitle>
          {data?.latest && <span className="text-[13px] text-r-muted">{tf("map_hatch_note", { day: dayMonth(data.latest, lang) })}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RSegmented label={t("map_metric")} value={metric} onChange={onMetric}
            options={[{ value: "reporting", label: t("map_m_reporting_short") }, { value: "field", label: fieldLabel }, { value: "change", label: t("map_m_change_short") }]} />
          <RButton size="sm" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>{t(asTable ? "show_as_charts" : "show_as_table")}</RButton>
        </div>
      </div>
      {metric === "change" && data && !data.comparable && <p className="m-0 text-sm text-r-muted">{t("no_compare")}</p>}
      {!data ? <div className="h-96 animate-pulse rounded-xl bg-r-sunk" /> : asTable ? (
        <MapTable rows={rows} valueOf={valueOf} fmt={fmt} label={label} onPick={(c) => { setSelected(OFFICE_GEO[c] ?? c); setAsTable(false); }} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          {onMap ? (
            <MaharashtraMap values={values} status={status} names={names} format={fmt} metricLabel={label} diverging={metric === "change"}
              selected={selected && MAP.districts.some((d) => d.id === selected) ? selected : null} onSelect={setSelected} pending={pending} />
          ) : <p className="m-0 text-r-muted">{t("map_no_districts")}</p>}
          <div className="flex min-w-0 flex-col gap-3">
            {sel ? <DistrictPanel row={sel} periods={data.periods} fieldLabel={fieldLabel} formId={formId} onClose={() => setSelected(null)} />
              : <p className="m-0 rounded-xl bg-r-ground p-3 text-sm text-r-muted">{t("map_click_hint")}</p>}
            {chips.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-r-muted">{t("map_units")}</span>
                <div className="flex flex-wrap gap-1.5">
                  {chips.map((r) => {
                    const v = valueOf(r);
                    return (
                      <button key={r.code} type="button" onClick={() => setSelected(r.code)} aria-pressed={sel?.code === r.code}
                        className={cn("cursor-pointer rounded-full border-[1.5px] px-2.5 py-0.5 text-[13px] font-bold text-r-ink",
                          !r.latest_reported ? "border-dashed border-r-overdue bg-r-card" : "border-r-line bg-r-card", sel?.code === r.code && "border-r-ink")}>
                        {name(r)} <span className="num font-normal text-r-muted">{v === null ? "—" : fmt(v)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </RCard>
  );
}

function DistrictPanel({ row, periods, fieldLabel, formId, onClose }: { row: MapRow; periods: string[]; fieldLabel: string; formId: number; onClose: () => void }) {
  const { t, tf, name, lang } = useT();
  const missed = row.due - row.sent;
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border-[1.5px] border-r-line p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <b className="text-[17px]">{name(row)}</b>
          <span className="text-[13px] text-r-muted">{row.division_mr}</span>
        </div>
        <button type="button" onClick={onClose} aria-label={t("close")} className="cursor-pointer rounded-md border-0 bg-transparent p-1 text-r-muted hover:bg-r-sunk"><X className="size-4" /></button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-xs text-r-muted">{tf("map_m_field", { f: fieldLabel })}</span>
          <b className="disp num text-[26px] leading-none">{fig(row.per_day)}</b>
          <span className="num text-xs text-r-muted">{t("total")} {fig(row.total)}</span>
        </span>
        <Sparkline values={row.series} width={120} height={36} label={`${fieldLabel}: ${row.series.map((v, i) => `${dayMonth(periods[i], lang)} ${v === null ? "—" : fig(v)}`).join(", ")}`} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <RChip>{tf("mv_sent", { a: row.sent, b: row.due })}</RChip>
        {missed > 0 && <RChip className="bg-r-overdue-soft text-r-overdue-ink">{tf("map_missed_n", { n: missed })}</RChip>}
        <RChip tone={row.latest_reported ? "plain" : "outline"}>{row.latest_reported ? t("map_latest_in") : t("map_latest_missing")}</RChip>
      </div>
      <Link to={`/forms/responses?form=${formId}&q=${encodeURIComponent(row.name_mr)}`} className="text-sm font-bold text-r-action">{t("map_open_responses")}</Link>
    </div>
  );
}

function MapTable({ rows, valueOf, fmt, label, onPick }: { rows: MapRow[]; valueOf: (r: MapRow) => number | null; fmt: (n: number) => string; label: string; onPick: (code: string) => void }) {
  const { t, name } = useT();
  return (
    <div className="max-h-[60vh] overflow-auto rounded-xl border border-r-line scrollbar-thin">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0">
          <tr className="text-xs text-r-muted">
            <th className="border-b border-r-line bg-r-card px-3 py-2 text-left">{t("office")}</th>
            <th className="border-b border-r-line bg-r-card px-3 py-2 text-left">{t("division")}</th>
            <th className="border-b border-r-line bg-r-card px-3 py-2 text-right">{label}</th>
            <th className="border-b border-r-line bg-r-card px-3 py-2 text-right">{t("sent")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = valueOf(r);
            return (
              <tr key={r.code} className="cursor-pointer hover:bg-r-ground" onClick={() => onPick(r.code)}>
                <td className="border-b border-r-line-soft px-3 py-1.5 font-medium">{name(r)}</td>
                <td className="border-b border-r-line-soft px-3 py-1.5 text-r-muted">{r.division_mr}</td>
                <td className="num border-b border-r-line-soft px-3 py-1.5 text-right">{v === null ? <span className="text-r-faint">—</span> : fmt(v)}</td>
                <td className="num border-b border-r-line-soft px-3 py-1.5 text-right">{r.sent}/{r.due}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
