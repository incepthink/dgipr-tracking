import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { Attention, GroupKey, Groups, OfficeMap, SeriesPoint, Summary } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { useT, type TKey } from "@/lib/i18n";
import { cn, qs } from "@/lib/utils";
import { RButton, RCard, RCardTitle, RError, RPage, RTitle } from "@/components/reports/kit";
import { dayMonth, fig, rangeText } from "@/components/reports/period";
import { BriefCard } from "@/components/analytics/BriefCard";
import { GroupTile } from "@/components/analytics/GroupTile";
import { TrendBars } from "@/components/analytics/TrendBars";
import { fieldLabel, sumColumns, useFormFilters } from "../forms/common";
import { AnalyticsFilters, AnalyticsTabs, Pending, useAnalytics } from "./shell";

const GROUP_LABEL: Record<GroupKey, TKey> = { print: "grp_print", video: "grp_video", social: "grp_social", other: "grp_other" };

/** Analytics → Overview: the week on one screen, for someone who reads it in a minute — four big numbers, the brief,
 * totals by medium, the daily trend, and the offices at the top and at the bottom. Real data from the report forms. */
export default function InsightsOverview() {
  const { t, tf, lang, shortName: name } = useT();
  const me = useUser();
  const f = useFormFilters(7);
  const cols = sumColumns(f.form);
  const keys = cols.map((c) => c.key);
  const summary = useAnalytics<Summary>(f, "summary");
  const attention = useAnalytics<Attention>(f, "attention");
  const groups = useAnalytics<Groups>(f, "groups");
  const series = useAnalytics<SeriesPoint[]>(f, "series");
  const map = useAnalytics<OfficeMap>(f, "map");
  const error = summary.error ?? attention.error ?? groups.error;

  const sum = (o?: Record<string, number>) => (o ? keys.reduce((n, k) => n + (o[k] ?? 0), 0) : 0);
  const total = sum(summary.data?.totals);
  const before = sum(summary.data?.previous.totals);
  const comparable = !!groups.data?.comparable;
  const change = comparable && before > 0 ? Math.round((100 * (total - before)) / before) : null;
  const days = f.start && f.end ? Math.round((Date.parse(f.end) - Date.parse(f.start)) / 864e5) + 1 : 0;
  const a = attention.data;
  const toCheck = a ? a.streaks.length + a.spikes.length + a.repeats.length + a.corrections.length : 0;
  const rows = map.data?.rows ?? [];
  const top = rows.filter((r) => r.sent > 0 && r.per_day !== null).sort((x, y) => (y.per_day ?? 0) - (x.per_day ?? 0)).slice(0, 5);
  const low = rows.filter((r) => r.due > 0 && r.pct !== null).sort((x, y) => (x.pct ?? 0) - (y.pct ?? 0) || x.sent - y.sent).slice(0, 5);
  const full = `/office/form-analytics${qs({ form: f.formId || undefined, start: f.start, end: f.end, division: f.division || undefined })}`;

  return (
    <RPage>
      <RTitle title={t("nav_analytics")} sub={me.role === "zone" ? me.division?.label_mr : t("all_maharashtra")} />
      <AnalyticsTabs />
      <AnalyticsFilters f={f} note={groups.data && (comparable ? tf("compared_prev", { range: rangeText(groups.data.previous.start, groups.data.previous.end, lang) }) : t("no_compare"))} />

      {error ? <RError error={error} /> : (
        <>
          {/* four big numbers */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label={t("ov_total")} value={summary.data ? fig(total) : null} hint={t("ov_total_hint")}
              change={change} changeLabel={tf("ov_change", { n: days })} />
            <Kpi label={t("ov_reported")} value={a ? `${fig(a.sent)} / ${fig(a.offices)}` : null}
              hint={a?.period ? tf("ov_reported_hint", { day: dayMonth(a.period, lang) }) : ""} tone={a && a.sent === a.offices ? "good" : undefined} />
            <Kpi label={t("ov_missing")} value={a ? fig(a.missing.length) : null} hint={a?.period ? dayMonth(a.period, lang) : ""}
              tone={a && a.missing.length ? "bad" : "good"} />
            <Kpi label={t("ov_attention")} value={a ? fig(toCheck) : null} hint={t("ov_attention_hint")} tone={toCheck ? "warn" : undefined} />
          </div>

          <BriefCard formId={f.formId} division={f.division} enabled={f.ready} />

          <RCard>
            <RCardTitle>{t("totals_by_group")}</RCardTitle>
            {!groups.data ? <Pending h="h-28" /> : (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(210px,100%),1fr))] gap-2.5">
                {groups.data.groups.map((x) => (
                  <GroupTile key={x.key} label={t(GROUP_LABEL[x.key])} total={x.total} previous={x.previous} comparable={comparable}
                    series={x.series.map((p) => (p.reported ? p.value : null))}
                    sub={x.fields.map((k) => { const c = cols.find((c) => c.key === k); return c ? fieldLabel(c, lang) : k; }).join(", ")} />
                ))}
              </div>
            )}
          </RCard>

          {!series.data ? <Pending h="h-64" /> : !total ? <p className="m-0 rounded-2xl bg-r-card p-5 text-r-muted">{t("ov_no_data")}</p> : (
            <TrendBars data={series.data} keys={keys} title={t("ov_trend")} rangeLabel={rangeText(f.start, f.end, lang)} />
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <RCard className="gap-2">
              <RCardTitle>{t("ov_top")}</RCardTitle>
              {!map.data ? <Pending h="h-40" /> : !top.length ? <span className="text-sm text-r-muted">{t("ov_no_data")}</span> : (
                <ol className="m-0 flex list-none flex-col p-0">
                  {top.map((r, i) => (
                    <li key={r.code} className="flex items-center gap-3 border-b border-r-line-soft py-2.5 last:border-b-0">
                      <span className="num flex size-8 shrink-0 items-center justify-center rounded-full bg-r-action-soft font-bold text-r-action">{i + 1}</span>
                      <span className="flex min-w-0 flex-1 flex-col leading-tight">
                        <b className="truncate">{name(r)}</b>
                        <span className="text-[13px] text-r-muted">{r.division_mr} · {tf("n_of_days", { a: r.sent, b: r.due })}</span>
                      </span>
                      <span className="num text-right"><b className="text-lg">{fig(r.per_day)}</b> <span className="text-[13px] text-r-muted">{t("per_day_word")}</span></span>
                    </li>
                  ))}
                </ol>
              )}
            </RCard>
            <RCard className="gap-2">
              <RCardTitle>{t("ov_low")}</RCardTitle>
              {!map.data ? <Pending h="h-40" /> : !low.length ? <span className="text-sm text-r-muted">{t("ov_no_data")}</span> : (
                <ol className="m-0 flex list-none flex-col p-0">
                  {low.map((r) => (
                    <li key={r.code} className="flex items-center gap-3 border-b border-r-line-soft py-2.5 last:border-b-0">
                      <span className="flex min-w-0 flex-1 flex-col leading-tight">
                        <b className="truncate">{name(r)}</b>
                        <span className="text-[13px] text-r-muted">{r.division_mr}</span>
                      </span>
                      <span className={cn("num text-right font-bold", (r.pct ?? 0) < 50 ? "text-r-overdue-ink" : "text-r-ink")}>
                        {Math.round(r.pct ?? 0)}% <span className="text-[13px] font-normal text-r-muted">· {tf("n_of_days", { a: r.sent, b: r.due })}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </RCard>
          </div>

          <RButton asChild variant="pri" size="lg" className="self-start">
            <Link to={full}>{t("ov_full")} <ArrowRight aria-hidden /></Link>
          </RButton>
        </>
      )}
    </RPage>
  );
}

function Kpi({ label, value, hint, change, changeLabel }: {
  label: string; value: string | null; hint?: string; change?: number | null; changeLabel?: string; /** kept for callers; the boxes are all plain white now */ tone?: "good" | "bad" | "warn";
}) {
  return (
    <RCard className="gap-1 p-4">
      <span className="text-[13px] font-bold text-r-muted">{label}</span>
      {value === null ? <span className="h-9 w-24 animate-pulse rounded-lg bg-r-sunk" /> : <span className="num text-[30px] leading-tight font-bold">{value}</span>}
      {change !== null && change !== undefined && (
        <span className={cn("num text-sm font-bold", change > 0 ? "text-r-accepted" : change < 0 ? "text-r-overdue-ink" : "text-r-muted")}>
          {change > 0 ? "▲ +" : change < 0 ? "▼ " : ""}{change}% <span className="font-normal text-r-muted">{changeLabel}</span>
        </span>
      )}
      {hint && <span className="text-xs text-r-muted">{hint}</span>}
    </RCard>
  );
}
