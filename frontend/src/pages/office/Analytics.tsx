import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { api, type Attention, type FormField, type GroupKey, type Groups, type Heatmap, type Movers, type OfficeMap, type SeriesPoint } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { useT, type TKey } from "@/lib/i18n";
import { addDays, cn, qs } from "@/lib/utils";
import { RButton, RCard, RCardTitle, RError, RFilterBar, RInput, RLabel, RPage, RSegmented, RSelect, RTitle } from "@/components/reports/kit";
import { fig, rangeText } from "@/components/reports/period";
import { AttentionList } from "@/components/analytics/AttentionList";
import { AskBox } from "@/components/analytics/AskBox";
import { BriefCard } from "@/components/analytics/BriefCard";
import { CalendarHeatmap } from "@/components/analytics/CalendarHeatmap";
import { GroupTile } from "@/components/analytics/GroupTile";
import { MapCard, type MapMetric } from "@/components/analytics/MapCard";
import { MoversCard } from "@/components/analytics/MoversCard";
import { SmallMultiples } from "@/components/analytics/SmallMultiples";
import { SeriesTable, TrendBars } from "@/components/analytics/TrendBars";
import { fieldLabel, scopeQs, sumColumns, useFormFilters, type FormFilters } from "../forms/common";
import MyNumbersPage from "./MyNumbers";
import { DivisionPicker, FormPicker } from "./shared";

export default function AnalyticsPage() {
  const me = useUser();
  return me.role === "district" ? <MyNumbersPage /> : <StateAnalytics />;
}

function useAn<T>(f: FormFilters, path: string, extra: Record<string, string | number | undefined> = {}, enabled = true) {
  const q = scopeQs(f, extra);
  return useQuery({
    queryKey: ["analytics", f.formId, path, q], enabled: f.ready && enabled, placeholderData: (p) => p,
    queryFn: () => api.get<T>(`/api/forms/${f.formId}/analytics/${path}${q}`),
  });
}

const SECTIONS: { id: string; label: TKey }[] = [
  { id: "today", label: "sec_today" }, { id: "overview", label: "sec_overview" }, { id: "compare", label: "sec_compare" },
  { id: "tables", label: "sec_tables" }, { id: "ask", label: "sec_ask" },
];
const GROUP_LABEL: Record<GroupKey, TKey> = { print: "grp_print", video: "grp_video", social: "grp_social", other: "grp_other" };
const TABLE_LINKS: { kind: string; label: TKey }[] = [
  { kind: "daily_division", label: "tbl_daily_division" }, { kind: "cumulative_division", label: "tbl_cumulative_division" },
  { kind: "datewise", label: "tbl_datewise" }, { kind: "daily_office", label: "tbl_daily_office" },
  { kind: "cumulative_office", label: "tbl_cumulative_office" },
];

/**
 * Exceptions first: what needs attention today, then the overview (group totals, trend, map), fair comparisons
 * (rank with most improved, own-baseline drops, small multiples, the reporting calendar), links to the sheet
 * views, and the ask box. Zone users get the same page scoped to their division by the server.
 */
function StateAnalytics() {
  const { t, tf, lang } = useT();
  const me = useUser();
  const f = useFormFilters(14);
  const cols = sumColumns(f.form);
  // what the overview / map / compare sections measure: one field or one group
  const [pick, setPick] = React.useState<{ column?: string; group?: GroupKey }>({});
  const defaultCol = cols.find((c) => c.key === "facebook") ?? cols[0];
  const sel = pick.column || pick.group ? pick : { column: defaultCol?.key };
  const selFields: FormField[] = sel.group ? cols.filter((c) => groupOf(c) === sel.group) : cols.filter((c) => c.key === sel.column);
  const selLabel = sel.group ? t(GROUP_LABEL[sel.group]) : selFields[0] ? fieldLabel(selFields[0], lang) : "";
  const metricQs = { column: sel.column, group: sel.group };
  const [asTable, setAsTable] = React.useState(false);
  const [level, setLevel] = React.useState<"division" | "office">(me.role === "zone" ? "office" : "division");
  const [mapMetric, setMapMetric] = React.useState<MapMetric>("reporting");

  const attention = useAn<Attention>(f, "attention");
  const groups = useAn<Groups>(f, "groups");
  const series = useAn<SeriesPoint[]>(f, "series");
  const prev = groups.data?.previous;
  const prevSeries = useQuery({
    queryKey: ["analytics", f.formId, "series-prev", prev?.start, prev?.end, f.division], enabled: !!prev && f.ready && !!groups.data?.comparable, placeholderData: (p) => p,
    queryFn: () => api.get<SeriesPoint[]>(`/api/forms/${f.formId}/analytics/series${qs({ start: prev!.start, end: prev!.end, division: f.division })}`),
  });
  const map = useAn<OfficeMap>(f, "map", metricQs, !!selFields.length);
  const movers = useAn<Movers>(f, "movers", { ...metricQs, level }, !!selFields.length);
  const heat = useAn<Heatmap>(f, "heatmap", metricQs, !!selFields.length);

  // date presets
  const span = !f.form ? "14" : f.start === f.form.start_date && f.end === f.lastDay ? "all"
    : f.end === f.lastDay && f.start === addDays(f.lastDay, -6) ? "7" : f.end === f.lastDay && f.start === addDays(f.lastDay, -13) ? "14"
    : f.end === f.lastDay && f.start === addDays(f.lastDay, -29) ? "30" : "custom";
  const [custom, setCustom] = React.useState(false);
  const setSpan = (v: string) => {
    if (v === "custom") { setCustom(true); return; }
    setCustom(false);
    const days = { "7": 6, "14": 13, "30": 29 }[v];
    const st = v === "all" || !days ? f.form?.start_date : addDays(f.lastDay, -days);
    f.set({ start: st && f.form && st < f.form.start_date ? f.form.start_date : st, end: f.lastDay });
  };

  const g = groups.data;
  const error = attention.error ?? groups.error ?? series.error;
  const scopeName = f.division ? "" : me.role === "zone" ? me.division?.label_mr ?? "" : t("all_maharashtra");
  const drops = (map.data?.rows ?? []).filter((r) => r.delta_pct !== null && r.delta_pct <= -25 && (r.previous_per_day ?? 0) > 0 && r.pct !== null && r.pct >= 50)
    .sort((a, b) => (a.delta_pct ?? 0) - (b.delta_pct ?? 0));

  return (
    <RPage>
      <RTitle title={t("nav_analytics")} sub={me.role === "zone" ? `${me.division?.label_mr ?? ""} · ${t("read_only_short")}` : t("all_maharashtra")} />
      <RFilterBar>
        <FormPicker f={f} />
        <RLabel small label={t("dates")}>
          <RSelect value={custom ? "custom" : span} onChange={(e) => setSpan(e.target.value)}>
            <option value="7">{t("last7")}</option>
            <option value="14">{t("days14")}</option>
            <option value="30">{t("last30")}</option>
            <option value="all">{t("whole_form")}</option>
            <option value="custom">{t("custom_range")}</option>
          </RSelect>
        </RLabel>
        {(custom || span === "custom") && (
          <>
            <RLabel small label={t("from")}><RInput type="date" value={f.start} min={f.form?.start_date} max={f.end} onChange={(e) => e.target.value && f.set({ start: e.target.value })} /></RLabel>
            <RLabel small label={t("to")}><RInput type="date" value={f.end} min={f.start} max={f.lastDay} onChange={(e) => e.target.value && f.set({ end: e.target.value })} /></RLabel>
          </>
        )}
        <DivisionPicker f={f} />
        {g && <span className="pb-2 text-[13px] text-r-muted">{g.comparable ? tf("compared_prev", { range: rangeText(g.previous.start, g.previous.end, lang) }) : t("no_compare")}</span>}
      </RFilterBar>

      <nav aria-label={t("sec_nav")} className="sticky top-0 z-30 -mx-1 flex gap-1 overflow-x-auto bg-r-ground/95 px-1 py-2 backdrop-blur scrollbar-thin">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#an-${s.id}`} className="shrink-0 rounded-full border-[1.5px] border-r-line bg-r-card px-3 py-1 text-sm font-bold text-r-ink no-underline hover:border-r-action">{t(s.label)}</a>
        ))}
      </nav>

      {error ? <RError error={error} /> : (
        <>
          {/* 1. आज लक्ष द्या */}
          <Section id="today" title={t("sec_today")}>
            <BriefCard formId={f.formId} division={f.division} enabled={f.ready} />
            {!attention.data ? <div className="h-72 animate-pulse rounded-2xl bg-r-sunk" /> : <AttentionList data={attention.data} fields={cols} />}
          </Section>

          {/* 2. आढावा */}
          <Section id="overview" title={t("sec_overview")}>
            <RCard>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <RCardTitle>{t("totals_by_group")}</RCardTitle>
                <span className="text-[13px] text-r-muted">{t("pick_group_hint")}</span>
              </div>
              {!g ? <div className="h-28 animate-pulse rounded-lg bg-r-sunk" /> : (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(210px,100%),1fr))] gap-2.5">
                  {g.groups.map((x) => (
                    <GroupTile key={x.key} label={t(GROUP_LABEL[x.key])} total={x.total} previous={x.previous} comparable={g.comparable}
                      series={x.series.map((p) => (p.reported ? p.value : null))} selected={sel.group === x.key}
                      onClick={() => setPick({ group: x.key })}
                      sub={x.fields.map((k) => { const c = cols.find((c) => c.key === k); return c ? fieldLabel(c, lang) : k; }).join(", ")} />
                  ))}
                </div>
              )}
              <div role="group" aria-label={t("field")} className="flex flex-wrap gap-1.5">
                {cols.map((c) => (
                  <button key={c.key} type="button" aria-pressed={sel.column === c.key} onClick={() => setPick({ column: c.key })}
                    className={cn("min-h-8 cursor-pointer rounded-full border-[1.5px] px-3 text-[13px] font-bold",
                      sel.column === c.key ? "border-r-ink bg-r-ink text-r-card" : "border-r-field bg-r-card text-r-ink")}>
                    {fieldLabel(c, lang)}
                  </button>
                ))}
              </div>
            </RCard>

            {asTable ? (
              <>
                <div className="flex justify-end"><RButton size="sm" aria-pressed onClick={() => setAsTable(false)}>{t("show_as_charts")}</RButton></div>
                <SeriesTable data={series.data ?? []} cols={cols} />
              </>
            ) : (
              <TrendBars data={series.data} prev={g?.comparable ? prevSeries.data : undefined} keys={selFields.map((c) => c.key)}
                title={tf("per_day_title", { f: selLabel, scope: scopeName })} rangeLabel={rangeText(f.start, f.end, lang)}
                actions={<RButton size="sm" aria-pressed={false} onClick={() => setAsTable(true)}>{t("show_as_table")}</RButton>} />
            )}

            <MapCard data={map.data} metric={mapMetric} onMetric={setMapMetric} fieldLabel={selLabel} formId={f.formId} pending={map.isFetching} />
          </Section>

          {/* 3. तुलना */}
          <Section id="compare" title={t("sec_compare")}>
            <MoversCard data={movers.data} pending={movers.isFetching} title={tf("mv_title", { f: selLabel })}
              controls={me.role === "state" ? (
                <RSegmented label={t("rank_by")} value={level} onChange={setLevel}
                  options={[{ value: "division", label: t("by_division") }, { value: "office", label: t("by_office") }]} />
              ) : undefined} />

            <RCard className="gap-2">
              <RCardTitle>{t("base_title")}</RCardTitle>
              <span className="text-[13px] text-r-muted">{tf("base_hint", { f: selLabel })}</span>
              {!map.data ? <div className="h-20 animate-pulse rounded-lg bg-r-sunk" /> : !map.data.comparable ? <span className="text-sm text-r-muted">{t("no_compare")}</span>
                : !drops.length ? <span className="text-sm text-r-accepted">{t("base_none")}</span> : (
                <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-x-5 gap-y-1 p-0 text-sm">
                  {drops.slice(0, 12).map((r) => (
                    <li key={r.code} className="flex justify-between gap-2 border-b border-r-line-soft py-1">
                      <span className="truncate">{lang === "en" && r.name_en ? r.name_en : r.name_mr}</span>
                      <span className="num whitespace-nowrap"><span className="text-r-muted">{fig(r.previous_per_day)} → {fig(r.per_day)}</span> <b className="text-r-overdue-ink">−{Math.abs(Math.round(r.delta_pct ?? 0))}%</b></span>
                    </li>
                  ))}
                </ul>
              )}
            </RCard>

            <RCard className="gap-3">
              <RCardTitle>{me.role === "zone" ? tf("sm_title_office", { f: selLabel }) : tf("sm_title", { f: selLabel })}</RCardTitle>
              {!heat.data ? <div className="h-40 animate-pulse rounded-lg bg-r-sunk" /> : <SmallMultiples data={heat.data} byOffice={me.role === "zone"} metricLabel={selLabel} />}
            </RCard>

            <RCard className="gap-3">
              <div className="flex flex-col">
                <RCardTitle>{t("hm_title")}</RCardTitle>
                <span className="text-[13px] text-r-muted">{tf("hm_hint", { f: selLabel })}</span>
              </div>
              {heat.error ? <RError error={heat.error} /> : !heat.data ? <div className="h-80 animate-pulse rounded-lg bg-r-sunk" /> : <CalendarHeatmap data={heat.data} metricLabel={selLabel} />}
            </RCard>
          </Section>

          {/* 4. अहवाल (the sheet views, not duplicated here) */}
          <Section id="tables" title={t("sec_tables")}>
            <RCard className="gap-3">
              <span className="text-sm text-r-muted">{t("tbl_hint")}</span>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-2">
                {TABLE_LINKS.map((x) => (
                  <Link key={x.kind} to={`/office/reports${qs({ form: f.formId, table: x.kind, division: f.division || undefined })}`}
                    className="flex items-center gap-2 rounded-xl border-[1.5px] border-r-line bg-r-card px-3 py-2.5 font-bold text-r-ink no-underline hover:border-r-action">
                    <FileSpreadsheet className="size-4 text-r-action" aria-hidden />{t(x.label)}
                  </Link>
                ))}
              </div>
            </RCard>
          </Section>

          {/* 5. विचारा */}
          <Section id="ask" title={t("sec_ask")}>
            {f.ready && <AskBox formId={f.formId} scope={scopeQs(f)} />}
          </Section>
          <p className="m-0 text-[13px] text-r-muted">{t("totals_note")}</p>
        </>
      )}
    </RPage>
  );
}

/** Same rule as insights.group_of: an unknown or empty group counts as other. */
function groupOf(c: FormField): GroupKey {
  return c.group === "print" || c.group === "video" || c.group === "social" ? c.group : "other";
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={`an-${id}`} aria-labelledby={`an-${id}-h`} className="flex scroll-mt-16 flex-col gap-4">
      <h2 id={`an-${id}-h`} className="disp m-0 mt-2 text-[22px] font-bold">{title}</h2>
      {children}
    </section>
  );
}
