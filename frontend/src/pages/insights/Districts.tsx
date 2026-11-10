import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { MapRow, OfficeMap } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { useT, type TKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RCard, RError, RPage, RSearch, RTitle, StatusMark, markOf } from "@/components/reports/kit";
import { fig } from "@/components/reports/period";
import { MapCard, type MapMetric } from "@/components/analytics/MapCard";
import { useFormFilters } from "../forms/common";
import { AnalyticsFilters, AnalyticsTabs, Pending, useAnalytics } from "./shell";

type Col = "name" | "pct" | "total" | "per_day" | "delta_pct";
const COLS: { key: Col; label: TKey }[] = [
  { key: "name", label: "di_office" }, { key: "pct", label: "di_reported" }, { key: "total", label: "di_total" },
  { key: "per_day", label: "di_per_day" }, { key: "delta_pct", label: "di_change" },
];

/** Analytics → Districts: the map, then every office in one table — reporting, total, per reported day, change on the
 * period before, latest day — sortable by any column, searchable. All fields added up; real data from the forms. */
export default function InsightsDistricts() {
  const { t, lang, shortName: name } = useT();
  const me = useUser();
  const f = useFormFilters(7);
  const map = useAnalytics<OfficeMap>(f, "map");
  const [metric, setMetric] = React.useState<MapMetric>("reporting");
  const [sort, setSort] = React.useState<{ key: Col; dir: 1 | -1 }>({ key: "per_day", dir: -1 });
  const [q, setQ] = React.useState("");
  const rows = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (map.data?.rows ?? []).filter((r) => !needle || [r.name_mr, r.name_en, r.division_mr, r.code].some((s) => s?.toLowerCase().includes(needle)));
    const val = (r: MapRow) => (sort.key === "name" ? name(r) : r[sort.key]);
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return typeof x === "number" && typeof y === "number" ? sort.dir * (x - y) : sort.dir * String(x).localeCompare(String(y), lang);
    });
  }, [map.data, q, sort, name, lang]);
  const by = (key: Col) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "name" ? 1 : -1 }));

  return (
    <RPage>
      <RTitle title={t("ins_districts")} sub={`${t("di_sub")}${me.role === "zone" && me.division ? ` · ${me.division.label_mr}` : ""}`} />
      <AnalyticsTabs />
      <AnalyticsFilters f={f} note={map.data && !map.data.comparable ? t("no_compare") : undefined} />
      {map.error ? <RError error={map.error} /> : (
        <>
          <MapCard data={map.data} metric={metric} onMetric={setMetric} fieldLabel={t("di_all_fields")} formId={f.formId} pending={map.isFetching} />
          <RCard className="gap-3">
            <RSearch value={q} onChange={setQ} placeholder={t("po_search")} />
            {!map.data ? <Pending h="h-96" /> : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[560px] border-separate border-spacing-0 text-[15px]">
                  <thead>
                    <tr>
                      <th className="border-b border-r-line px-2 py-2 text-left text-xs text-r-muted">#</th>
                      {COLS.map((c) => (
                        <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                          className={cn("border-b border-r-line p-1", c.key === "name" ? "text-left" : "text-right")}>
                          <button type="button" onClick={() => by(c.key)}
                            className={cn("inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-lg border-0 px-2 text-xs font-bold",
                              sort.key === c.key ? "bg-r-action-soft text-r-action" : "bg-transparent text-r-muted hover:bg-r-sunk")}>
                            {t(c.label)}{sort.key === c.key && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                          </button>
                        </th>
                      ))}
                      <th className="border-b border-r-line px-2 py-2 text-center text-xs text-r-muted">{t("di_latest")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.code} className="even:bg-r-ground/60">
                        <td className="num border-b border-r-line-soft px-2 py-2 text-r-muted">{i + 1}</td>
                        <td className="border-b border-r-line-soft px-2 py-2">
                          <span className="flex flex-col leading-tight"><b>{name(r)}</b><span className="text-[13px] text-r-muted">{r.division_mr}</span></span>
                        </td>
                        <td className={cn("num border-b border-r-line-soft px-2 py-2 text-right", (r.pct ?? 100) < 50 && "font-bold text-r-overdue-ink")}>
                          {r.pct === null ? "—" : `${Math.round(r.pct)}%`} <span className="text-[13px] text-r-muted">({r.sent}/{r.due})</span>
                        </td>
                        <td className="num border-b border-r-line-soft px-2 py-2 text-right">{r.sent ? fig(r.total) : "—"}</td>
                        <td className="num border-b border-r-line-soft px-2 py-2 text-right font-bold">{fig(r.per_day)}</td>
                        <td className={cn("num border-b border-r-line-soft px-2 py-2 text-right font-bold",
                          r.delta_pct === null ? "text-r-muted" : r.delta_pct > 0 ? "text-r-accepted" : r.delta_pct < 0 ? "text-r-overdue-ink" : "")}>
                          {r.delta_pct === null ? "—" : `${r.delta_pct > 0 ? "+" : ""}${Math.round(r.delta_pct)}%`}
                        </td>
                        <td className="border-b border-r-line-soft px-2 py-2 text-center"><StatusMark mark={markOf(r.latest, !r.latest_reported)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </RCard>
        </>
      )}
    </RPage>
  );
}
