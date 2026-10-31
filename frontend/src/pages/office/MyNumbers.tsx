import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Attention, type Peer, type PeriodsResponse, type SeriesPoint, type Summary } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { addDays, cn, qs } from "@/lib/utils";
import { RCard, RCardTitle, RError, RFilterBar, RPage, RStat, RTitle } from "@/components/reports/kit";
import { DateRangeInput, type DateRange, type RangePreset } from "@/components/reports/DateRangeInput";
import { dayMonth, fig, isOverdue, rangeText } from "@/components/reports/period";
import { fieldLabel, formTitle, scopeQs, sumColumns, useFormFilters, type FormFilters } from "../forms/common";
import { FormPicker } from "./shared";

/** The district office's own figures over the whole form so far: what is still to send, its own unusual figures,
 * periods sent, coverage, totals with per day vs the division's average, and a day-by-day bar for one field. */
export default function MyNumbersPage() {
  const { t, tf, shortName, lang } = useT();
  const me = useUser();
  const filters = useFormFilters();
  // the whole form so far; only the totals table picks its own dates
  const f = { ...filters, start: filters.form?.start_date ?? "", end: filters.lastDay };
  const office = me.office?.code ?? "";
  const columns = sumColumns(f.form);
  const [pick, setPick] = React.useState(ALL);
  const field = columns.find((c) => c.key === pick) ?? columns[0];

  const q = scopeQs(f);
  const summary = useQuery({ queryKey: ["analytics", f.formId, "summary", q], enabled: f.ready, queryFn: () => api.get<Summary>(`/api/forms/${f.formId}/analytics/summary${q}`), placeholderData: (p) => p });
  const series = useQuery({ queryKey: ["analytics", f.formId, "series", q], enabled: f.ready, queryFn: () => api.get<SeriesPoint[]>(`/api/forms/${f.formId}/analytics/series${q}`), placeholderData: (p) => p });
  const periods = useQuery({
    queryKey: ["form-periods", f.formId, office, f.start, f.end], enabled: f.ready && !!office,
    queryFn: () => api.get<PeriodsResponse>(`/api/forms/${f.formId}/periods${qs({ office, start: f.start, end: f.end })}`),
  });
  const att = useQuery({ queryKey: ["analytics", f.formId, "attention", q], enabled: f.ready, queryFn: () => api.get<Attention>(`/api/forms/${f.formId}/analytics/attention${q}`), placeholderData: (p) => p });
  const ps = periods.data?.periods ?? [];
  const toSend = ps.filter((p) => (p.status === "none" || p.status === "draft" || p.status === "returned") && !p.read_only_reason);
  const flags = [...(att.data?.spikes ?? []), ...(att.data?.repeats ?? [])];
  const sent = ps.filter((p) => ["submitted", "returned"].includes(p.status));
  const late = sent.filter((p) => p.late).length;
  const s = summary.data;
  const error = summary.error ?? series.error ?? periods.error;

  return (
    <RPage>
      <RTitle title={t("nav_my_numbers")} sub={<>{shortName(me.office)}{f.form && <> · {formTitle(f.form, lang)}</>}</>} />
      <RFilterBar>
        <FormPicker f={f} />
        {s && <span className="pb-2 text-[13px] text-r-muted">{rangeText(s.start, s.end, lang)}</span>}
      </RFilterBar>

      {error ? <RError error={error} /> : (
        <>
          <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <RCard className="gap-2.5">
              <RCardTitle>{t("mine_due_today")}</RCardTitle>
              {!periods.data ? <div className="h-16 animate-pulse rounded-lg bg-r-sunk" /> : !toSend.length ? <span className="font-bold text-r-accepted">{t("mine_due_none")}</span> : (
                <div className="flex flex-wrap gap-1.5">
                  {toSend.slice(-6).reverse().map((p) => (
                    <Link key={p.period_start} to={`/forms/${f.formId}/fill${qs({ office, period: p.period_start })}`}
                      className={cn("rounded-full border-[1.5px] px-3 py-1 text-sm font-bold no-underline hover:border-r-action",
                        isOverdue(p.status, p.deadline) ? "border-r-overdue text-r-overdue-ink" : "border-r-line text-r-ink")}>
                      {dayMonth(p.period_start, lang)} · {t(`sub_${p.status}` as "sub_none")} {t("mine_open")}
                    </Link>
                  ))}
                </div>
              )}
              {flags.length > 0 && (
                <div className="flex flex-col gap-1 border-t border-r-line-soft pt-2.5">
                  <span className="text-[13px] font-bold text-r-returned-ink">{t("mine_flags")}</span>
                  {flags.map((x) => {
                    const c = columns.find((c) => c.key === x.field);
                    return (
                      <span key={x.kind + x.date} className="text-sm">
                        {dayMonth(x.date, lang)}: {x.kind === "spike"
                          ? <>{c ? fieldLabel(c, lang) : x.field} <b className="num">{fig(x.value)}</b> <span className="text-r-muted">({tf("att_usual", { n: fig(x.expected) })})</span></>
                          : <span className="text-r-muted">{tf("att_same_as", { day: dayMonth(x.previous ?? x.date, lang) })}</span>}
                      </span>
                    );
                  })}
                </div>
              )}
            </RCard>
            <RStat label={t("days_sent")} value={periods.data ? sent.length : "–"} of={periods.data ? ps.length : undefined}
              sub={late > 0 ? tf("n_late", { n: late }) : undefined} progress={ps.length ? (100 * sent.length) / ps.length : undefined} />
            <RStat label={t("fields_filled")} value={s ? `${Math.round(s.coverage.pct)}%` : "–"}
              sub={s ? tf("of_expected", { n: fig(s.coverage.expected_cells) }) : undefined} progress={s?.coverage.pct} />
          </section>

          <FieldTotals key={f.formId} f={f} columns={columns} />
          <p className="m-0 text-[13px] text-r-muted">{t("totals_note")}</p>

          {field && <DayBars f={f} data={series.data} field={field.key} label={fieldLabel(field, lang)} columns={columns} pick={pick === ALL ? ALL : field.key} onPick={setPick} />}
        </>
      )}
    </RPage>
  );
}

type Column = { key: string; label_mr: string; label_en: string };

const head = "border-b-[1.5px] border-r-ink px-2 py-2 align-bottom text-xs leading-snug font-bold whitespace-nowrap text-r-muted sm:px-3 sm:whitespace-normal";
const cell = "border-b border-r-line-soft px-2 py-3 group-hover:bg-r-ground sm:px-3";

/** One row per field: the office's total, then its average per day sent against its division's, with a bar so
 * "above / below the division" reads without doing the sum. The range is picked on this card only and starts on
 * the whole form. */
function FieldTotals({ f, columns }: { f: FormFilters; columns: Column[] }) {
  const { t, tf, lang } = useT();
  const lo = f.form?.start_date ?? "";
  const hi = f.lastDay;
  const clamp = (d: string) => (d < lo ? lo : d);
  const [picked, setPicked] = React.useState<DateRange | null>(null);
  const r = picked ?? { start: f.start, end: f.end };
  const peer = useQuery({
    queryKey: ["analytics", f.formId, "peer", r.start, r.end], enabled: f.ready && !!r.start && !!r.end,
    queryFn: () => api.get<Peer>(`/api/forms/${f.formId}/analytics/peer${qs(r)}`), placeholderData: (p) => p,
  });
  const p = peer.data;
  const presets: RangePreset[] = !lo || !hi ? [] : [
    { label: t("last7"), start: clamp(addDays(hi, -6)), end: hi },
    { label: t("last30"), start: clamp(addDays(hi, -29)), end: hi },
    { label: t("rng_all"), start: lo, end: hi },
  ];
  // counts, so per-day figures are shown (and compared) as whole numbers
  const whole = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n));
  return (
    <RCard className="gap-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <RCardTitle>{t("totals_by_field")}</RCardTitle>
          <span className="text-[13px] text-r-muted">{t("vd_hint")}</span>
        </div>
        <DateRangeInput value={r} min={lo} max={hi} presets={presets} onChange={(x) => setPicked({ start: clamp(x.start), end: x.end > hi ? hi : x.end })} />
      </div>
      {peer.error ? <RError error={peer.error} /> : !p ? <div className="mt-2 h-40 animate-pulse rounded-lg bg-r-sunk" /> : (
        <>
          <span className="pt-1 text-[13px] text-r-muted">
            {tf("vd_sent", { mine: p.mine.periods_reported, n: p.offices, all: p.periods_reported })}
          </span>
          <div className="-mx-1 mt-2 overflow-x-auto scrollbar-thin">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {/* phones get one short word per heading; the range and office count are already in the picker and the line above */}
                  <th scope="col" className={cn(head, "sticky left-0 z-1 min-w-28 bg-r-card text-left sm:min-w-36")}>{t("field")}</th>
                  <th scope="col" className={cn(head, "text-center")}>{t("ft_g_total")}<span className="hidden font-normal sm:block">{rangeText(r.start, r.end, lang)}</span></th>
                  <th scope="col" className={cn(head, "border-l border-l-r-line-soft text-center")}>
                    <span className="sm:hidden">{t("ft_s_you")}</span><span className="hidden sm:inline">{t("ft_you")}</span>
                    <span className="hidden font-normal sm:block">{t("ft_g_per_day")}</span>
                  </th>
                  <th scope="col" className={cn(head, "text-center")}>
                    <span className="sm:hidden">{t("ft_s_div")}</span><span className="hidden sm:inline">{t("mine_vs_div")}</span>
                    <span className="hidden font-normal sm:block">{tf("ft_offices", { n: p.offices })}</span>
                  </th>
                  <th scope="col" className={cn(head, "text-center")}>
                    <span className="sm:hidden">{t("ft_s_vs")}</span><span className="hidden sm:inline">{t("ft_vs_div")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {columns.map((c) => {
                  const rawMine = p.mine.per_day[c.key] ?? null;
                  const rawAvg = p.per_day[c.key] ?? null;
                  const mine = whole(rawMine);
                  const avg = whole(rawAvg);
                  // the percentage uses the unrounded averages (0.3 shows as 0 but isn't 0); nothing at all vs nothing is 0%,
                  // anything vs a true 0 has no percentage
                  const gap = rawMine === null || rawAvg === null ? null : rawAvg ? Math.round((100 * (rawMine - rawAvg)) / rawAvg) : rawMine ? null : 0;
                  return (
                    <tr key={c.key} className="group">
                      <th scope="row" className={cn(cell, "sticky left-0 z-1 bg-r-card text-left text-[15px] font-medium")}>{fieldLabel(c, lang)}</th>
                      <td className={cn(cell, "num text-center text-base font-bold")}>{fig(p.mine.totals[c.key])}</td>
                      <td className={cn(cell, "num border-l border-l-r-line-soft text-center font-bold")}>{fig(mine)}</td>
                      <td className={cn(cell, "num text-center text-r-muted")}>{fig(avg)}</td>
                      <td className={cn(cell, "num text-center font-bold whitespace-nowrap",
                        gap === null ? "text-r-faint" : gap < 0 ? "text-r-overdue-ink" : gap > 0 ? "text-r-accepted" : "text-r-muted")}>
                        {gap === null ? "—" : gap > 0 ? `+${gap}%` : gap < 0 ? `−${-gap}%` : "0%"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </RCard>
  );
}

const ALL = "__all";

/** One bar per day for one field, or with "All" for every field added together. A day with nothing counted is a
 * dashed outline, never a zero-height bar. */
export function DayBars({ data, field: one, label: oneLabel, columns, pick, onPick, compare: cmp }: {
  f?: FormFilters; data?: SeriesPoint[]; field: string; label: string; columns: Column[];
  pick: string; onPick: (k: string) => void; compare?: SeriesPoint[];
}) {
  const { t, lang } = useT();
  const all = pick === ALL;
  const combine = (ps?: SeriesPoint[]) => !all ? ps : ps?.map((p): SeriesPoint => ({ ...p, values: { ...p.values, [ALL]: columns.reduce((a, c) => a + (p.values[c.key] ?? 0), 0) } }));
  const rows = combine(data) ?? [];
  const compare = combine(cmp);
  const field = all ? ALL : one;
  const label = all ? t("all_fields_total") : oneLabel;
  const chips = (
    <div role="group" aria-label={t("field")} className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-thin">
      {[{ key: ALL, label_mr: t("all_fields"), label_en: t("all_fields") }, ...columns].map((c) => (
        <button key={c.key} type="button" aria-pressed={c.key === pick} onClick={() => onPick(c.key)}
          className={cn("min-h-10 flex-none cursor-pointer rounded-full border-[1.5px] px-3.5 text-sm font-bold",
            c.key === pick ? "border-r-ink bg-r-ink text-r-card" : "border-r-field bg-r-card text-r-ink")}>
          {fieldLabel(c, lang)}
        </button>
      ))}
    </div>
  );
  const max = Math.max(1, ...rows.map((p) => (p.entered_cells ? p.values[field] ?? 0 : 0)), ...(compare ?? []).map((p) => p.values[field] ?? 0));
  const nice = niceMax(max);
  const H = 200;
  const counted = rows.filter((p) => p.entered_cells);
  const top = counted.reduce<SeriesPoint | null>((a, p) => (!a || (p.values[field] ?? 0) > (a.values[field] ?? 0) ? p : a), null);
  const many = rows.length > 16;
  return (
    <RCard className="gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <RCardTitle>{t("day_by_day")}</RCardTitle>
        <span className="text-sm text-r-muted">{label}</span>
      </div>
      {chips}
      {!data ? <div className="h-44 animate-pulse rounded-lg bg-r-sunk" /> : (
        <div role="img" aria-label={`${label}: ${rows.map((p) => `${dayMonth(p.date, lang)} ${p.entered_cells ? fig(p.values[field]) : t("not_counted")}`).join(", ")}`} className="flex flex-col gap-1.5">
          <div className="relative flex items-end gap-1 border-b-[1.5px] border-r-ink" style={{ height: H }}>
            <div aria-hidden className="absolute inset-x-0 border-t border-dashed border-r-line" style={{ bottom: H * 0.75 }} />
            <span aria-hidden className="num absolute left-0 bg-r-card pr-1 text-[11px] text-r-muted" style={{ bottom: H * 0.75 + 2 }}>{fig(Math.round(nice * 0.75))}</span>
            {rows.map((p, i) => {
              const v = p.values[field] ?? 0;
              const prev = compare?.[i]?.values[field];
              return (
                <div key={p.date} tabIndex={0} className="group relative flex h-full flex-1 flex-col justify-end outline-none">
                  {p.entered_cells ? (
                    <div className="rounded-t bg-r-action group-hover:opacity-85 group-focus-visible:outline-2 group-focus-visible:outline-r-focus" style={{ height: Math.max(2, (v / nice) * H) }} />
                  ) : (
                    <div className="rounded-t border-[1.5px] border-b-0 border-dashed border-r-faint" style={{ height: Math.min(30, H / 4) }} />
                  )}
                  {prev !== undefined && <div aria-hidden className="absolute -inset-x-0.5 border-t-2 border-r-muted shadow-[0_0_0_1px_var(--r-card)]" style={{ bottom: (prev / nice) * H }} />}
                  {/* bars near either end anchor their tooltip inward so it stays on a phone screen */}
                  <span role="tooltip" className={cn("pointer-events-none absolute bottom-full z-10 mb-1 hidden rounded-md",
                    i < rows.length / 4 ? "left-0" : i >= (3 * rows.length) / 4 ? "right-0" : "left-1/2 -translate-x-1/2", "bg-r-ink px-2 py-1 text-xs whitespace-nowrap text-r-card group-hover:block group-focus-visible:block")}>
                    {dayMonth(p.date, lang)}: <b className="num">{p.entered_cells ? fig(v) : "—"}</b>{!p.entered_cells && ` · ${t("not_counted")}`}
                    {prev !== undefined && <> · {t("vs_prev")}: <span className="num">{fig(prev)}</span></>}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex gap-1" aria-hidden>
            {rows.map((p, i) => (
              <span key={p.date} className="num flex-1 text-center text-[10px] text-r-muted">
                {!many || i % Math.ceil(rows.length / 10) === 0 || i === rows.length - 1 ? new Date(p.date + "T00:00:00").getDate() : ""}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-3.5 text-[13px] text-r-muted">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-r-action" />{t("counted")}</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] border-[1.5px] border-dashed border-r-faint" />{t("not_counted")}</span>
        {top && <span className="ml-auto">↑ <span className="num">{fig(top.values[field])}</span> · {dayMonth(top.date, lang)}</span>}
      </div>
    </RCard>
  );
}

function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return v;
}
