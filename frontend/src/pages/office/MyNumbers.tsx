import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Attention, type Peer, type PeriodsResponse, type SeriesPoint, type Summary } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { addDays, cn, qs } from "@/lib/utils";
import { RCard, RCardTitle, RError, RFilterBar, RLabel, RPage, RSegmented, RStat, RTitle } from "@/components/reports/kit";
import { deltaPct, dayMonth, fig, isOverdue, rangeText } from "@/components/reports/period";
import { fieldLabel, formTitle, scopeQs, sumColumns, useFormFilters, type FormFilters } from "../forms/common";
import { FormPicker } from "./shared";

/** The district office's own figures: what is still to send, its own unusual figures, periods sent, coverage, a
 * day-by-day bar for one field, and totals vs before and per day vs the division's average. */
export default function MyNumbersPage() {
  const { t, tf, shortName, lang } = useT();
  const me = useUser();
  const f = useFormFilters(14);
  const office = me.office?.code ?? "";
  const columns = sumColumns(f.form);
  const [pick, setPick] = React.useState(ALL);
  const field = columns.find((c) => c.key === pick) ?? columns[0];

  const span = f.form && f.start === f.form.start_date ? "all" : f.start && f.end && f.start === addDays(f.end, -6) ? "7" : "14";
  const setSpan = (v: string) => f.set({
    start: v === "all" ? f.form?.start_date : addDays(f.lastDay, v === "7" ? -6 : -13) < (f.form?.start_date ?? "") ? f.form?.start_date : addDays(f.lastDay, v === "7" ? -6 : -13),
    end: f.lastDay,
  });

  const q = scopeQs(f);
  const summary = useQuery({ queryKey: ["analytics", f.formId, "summary", q], enabled: f.ready, queryFn: () => api.get<Summary>(`/api/forms/${f.formId}/analytics/summary${q}`), placeholderData: (p) => p });
  const series = useQuery({ queryKey: ["analytics", f.formId, "series", q], enabled: f.ready, queryFn: () => api.get<SeriesPoint[]>(`/api/forms/${f.formId}/analytics/series${q}`), placeholderData: (p) => p });
  const periods = useQuery({
    queryKey: ["form-periods", f.formId, office, f.start, f.end], enabled: f.ready && !!office,
    queryFn: () => api.get<PeriodsResponse>(`/api/forms/${f.formId}/periods${qs({ office, start: f.start, end: f.end })}`),
  });
  const peer = useQuery({ queryKey: ["analytics", f.formId, "peer", q], enabled: f.ready, queryFn: () => api.get<Peer>(`/api/forms/${f.formId}/analytics/peer${q}`), placeholderData: (p) => p });
  const att = useQuery({ queryKey: ["analytics", f.formId, "attention", q], enabled: f.ready, queryFn: () => api.get<Attention>(`/api/forms/${f.formId}/analytics/attention${q}`), placeholderData: (p) => p });
  const ps = periods.data?.periods ?? [];
  const toSend = ps.filter((p) => (p.status === "none" || p.status === "draft" || p.status === "returned") && !p.read_only_reason);
  const flags = [...(att.data?.spikes ?? []), ...(att.data?.repeats ?? [])];
  const sent = ps.filter((p) => ["submitted", "returned"].includes(p.status));
  const late = sent.filter((p) => p.late).length;
  const s = summary.data;
  const comparable = !!s && !!f.form && s.previous.start >= f.form.start_date;
  const error = summary.error ?? series.error ?? periods.error;
  const perDay = (k: string) => (sent.length && s ? s.totals[k] / sent.length : null);

  return (
    <RPage>
      <RTitle title={t("nav_my_numbers")} sub={<>{shortName(me.office)}{f.form && <> · {formTitle(f.form, lang)}</>}</>} />
      <RFilterBar>
        <FormPicker f={f} />
        <RLabel small label={t("period")}>
          <RSegmented label={t("period")} value={span} onChange={setSpan}
            options={[{ value: "7", label: t("days7") }, { value: "14", label: t("days14") }, { value: "all", label: t("whole_form") }]} />
        </RLabel>
        {s && <span className="pb-2 text-[13px] text-r-muted">{comparable ? tf("compared_with", { a: rangeText(s.start, s.end, lang), b: rangeText(s.previous.start, s.previous.end, lang) }) : `${rangeText(s.start, s.end, lang)} · ${t("no_compare")}`}</span>}
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

          {field && <DayBars f={f} data={series.data} field={field.key} label={fieldLabel(field, lang)} columns={columns} pick={pick === ALL ? ALL : field.key} onPick={setPick} />}

          <FieldTotals s={s} comparable={comparable} columns={columns} perDay={perDay} peer={peer.data} />
          <p className="m-0 text-[13px] text-r-muted">{t("totals_note")}</p>
        </>
      )}
    </RPage>
  );
}

type Column = { key: string; label_mr: string; label_en: string };

/** One row per field: this period's total against the period before, then the office's average per period sent
 * against the division's, with a bar so "above / below the division" reads without doing the sum. */
function FieldTotals({ s, comparable, columns, perDay, peer }: {
  s?: Summary; comparable: boolean; columns: Column[]; perDay: (k: string) => number | null; peer?: Peer;
}) {
  const { t, tf, lang } = useT();
  const hasPeer = !!peer && columns.some((c) => peer.per_day[c.key] != null);
  const head = "border-b-[1.5px] border-r-ink px-3 py-2 align-bottom text-xs leading-snug font-bold text-r-muted";
  const group = "px-3 pt-1 text-left text-[11px] font-bold tracking-wide text-r-ink uppercase";
  const cell = "border-b border-r-line-soft px-3 py-3 group-hover:bg-r-ground";
  const one = (n: number | null | undefined) => fig(n === null || n === undefined ? n : Math.round(n * 10) / 10);
  return (
    <RCard className="gap-1">
      <RCardTitle>{t("totals_by_field")}</RCardTitle>
      <span className="text-[13px] text-r-muted">{hasPeer ? t("ft_hint") : t("ft_hint_nopeer")}</span>
      {!s ? <div className="mt-2 h-40 animate-pulse rounded-lg bg-r-sunk" /> : (
        <div className="-mx-1 mt-2 overflow-x-auto scrollbar-thin">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th />
                <th colSpan={3} scope="colgroup" className={cn(group, "border-l border-r-line-soft")}>{t("ft_g_total")}</th>
                {hasPeer && <th colSpan={3} scope="colgroup" className={cn(group, "border-l border-r-line-soft")}>{t("ft_g_per_day")}</th>}
              </tr>
              <tr>
                <th scope="col" className={cn(head, "min-w-36 text-left")}>{t("field")}</th>
                <th scope="col" className={cn(head, "border-l border-l-r-line-soft text-right")}>{t("ft_now")}<span className="block font-normal">{rangeText(s.start, s.end, lang)}</span></th>
                <th scope="col" className={cn(head, "text-right")}>{t("ft_before")}<span className="block font-normal">{comparable ? rangeText(s.previous.start, s.previous.end, lang) : "—"}</span></th>
                <th scope="col" className={cn(head, "text-right")}>{t("ft_change")}</th>
                {hasPeer && <>
                  <th scope="col" className={cn(head, "border-l border-l-r-line-soft text-right")}>{t("ft_you")}</th>
                  <th scope="col" className={cn(head, "text-right")}>{t("mine_vs_div")}<span className="block font-normal">{tf("ft_offices", { n: peer!.offices })}</span></th>
                  <th scope="col" className={cn(head, "min-w-40 text-left")}>{t("ft_vs_div")}</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {columns.map((c) => {
                const now = s.totals[c.key];
                const before = comparable ? s.previous.totals[c.key] : undefined;
                const d = comparable ? deltaPct(now, before) : null;
                const mine = perDay(c.key);
                const avg = peer?.per_day[c.key];
                const gap = mine !== null && avg ? Math.round((100 * (mine - avg)) / avg) : null;
                const top = Math.max(mine ?? 0, avg ?? 0) || 1;
                return (
                  <tr key={c.key} className="group">
                    <th scope="row" className={cn(cell, "text-left text-[15px] font-medium")}>{fieldLabel(c, lang)}</th>
                    <td className={cn(cell, "num border-l border-l-r-line-soft text-right text-base font-bold")}>{fig(now)}</td>
                    <td className={cn(cell, "num text-right text-r-muted")}>{fig(before)}</td>
                    <td className={cn(cell, "num text-right font-semibold whitespace-nowrap", !d || !d.dir ? "text-r-muted" : d.dir > 0 ? "text-r-accepted" : "text-r-overdue-ink")}>
                      {!d ? "—" : d.text === "new" ? t("ft_new") : d.dir > 0 ? `↑ ${d.text.slice(1)}` : d.dir < 0 ? `↓ ${d.text.slice(1)}` : t("ft_same")}
                    </td>
                    {hasPeer && <>
                      <td className={cn(cell, "num border-l border-l-r-line-soft text-right font-bold")}>{one(mine)}</td>
                      <td className={cn(cell, "num text-right text-r-muted")}>{one(avg)}</td>
                      <td className={cn(cell)}>
                        {gap === null ? <span className="text-r-faint">—</span> : (
                          <div className="flex items-center gap-2.5">
                            <div aria-hidden className="relative h-2.5 w-20 flex-none rounded-full bg-r-sunk">
                              <div className={cn("h-full rounded-full", gap < 0 ? "bg-r-overdue" : "bg-r-accepted")} style={{ width: `${(100 * (mine ?? 0)) / top}%` }} />
                              <div className="absolute -top-1 -bottom-1 w-0.5 bg-r-ink" style={{ left: `calc(${(100 * avg!) / top}% - 1px)` }} />
                            </div>
                            <span className={cn("text-[13px] font-semibold whitespace-nowrap", gap < 0 ? "text-r-overdue-ink" : gap > 0 ? "text-r-accepted" : "text-r-muted")}>
                              {gap > 0 ? tf("ft_above", { n: gap }) : gap < 0 ? tf("ft_below", { n: -gap }) : t("ft_same")}
                            </span>
                          </div>
                        )}
                      </td>
                    </>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {hasPeer && s && (
        <div className="flex flex-wrap items-center gap-3.5 pt-2 text-[13px] text-r-muted">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-full bg-r-accepted" />{t("ft_you")}</span>
          <span className="flex items-center gap-1.5"><span className="h-3.5 w-0.5 bg-r-ink" />{t("mine_vs_div")}</span>
        </div>
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
                  <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md bg-r-ink px-2 py-1 text-xs whitespace-nowrap text-r-card group-hover:block group-focus-visible:block">
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
