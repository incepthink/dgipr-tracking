import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Attention, type Peer, type PeriodsResponse, type SeriesPoint, type Summary } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { addDays, cn, qs } from "@/lib/utils";
import { RCard, RError, RLabel, RPage, RSegmented, RSelect } from "@/components/reports/kit";
import { deltaPct, dayMonth, fig, isOverdue, rangeText } from "@/components/reports/period";
import { fieldLabel, formTitle, scopeQs, sumColumns, useFormFilters, type FormFilters } from "../forms/common";

/** The district office's own figures: what is still to send, its own unusual figures, periods sent, coverage, a
 * day-by-day bar for one field, and totals vs before and per day vs the division's average. */
export default function MyNumbersPage() {
  const { t, tf, shortName, lang } = useT();
  const me = useUser();
  const f = useFormFilters(14);
  const office = me.office?.code ?? "";
  const columns = sumColumns(f.form);
  const [pick, setPick] = React.useState("");
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
    <RPage className="mx-auto w-full max-w-[720px] gap-3.5">
      <header className="flex flex-col gap-3">
        <div>
          <h1 className="disp m-0 text-[28px] leading-[1.1] font-bold">{t("nav_my_numbers")}</h1>
          <span className="text-sm text-r-muted">{shortName(me.office)}{f.form && <> · {formTitle(f.form, lang)}</>}</span>
        </div>
        {(f.forms?.length ?? 0) > 1 && (
          <RLabel small label={t("form")}>
            <RSelect value={f.formId} onChange={(e) => f.set({ form: e.target.value, start: null, end: null })} className="w-full">
              {f.forms!.map((x) => <option key={x.id} value={x.id}>{formTitle(x, lang)}</option>)}
            </RSelect>
          </RLabel>
        )}
        <RSegmented full label={t("period")} value={span} onChange={setSpan} className="rounded-xl p-1 [&>button]:min-h-11"
          options={[{ value: "7", label: t("days7") }, { value: "14", label: t("days14") }, { value: "all", label: t("whole_form") }]} />
        {s && <span className="text-sm text-r-muted">{comparable ? tf("compared_with", { a: rangeText(s.start, s.end, lang), b: rangeText(s.previous.start, s.previous.end, lang) }) : `${rangeText(s.start, s.end, lang)} · ${t("no_compare")}`}</span>}
      </header>

      {error ? <RError error={error} /> : (
        <>
          {periods.data && (
            <RCard className="gap-2 rounded-[14px] p-3.5">
              <span className="text-[13px] font-bold text-r-muted">{t("mine_due_today")}</span>
              {!toSend.length ? <span className="font-bold text-r-accepted">{t("mine_due_none")}</span> : (
                <div className="flex flex-wrap gap-1.5">
                  {toSend.slice(-6).reverse().map((p) => (
                    <Link key={p.period_start} to={`/forms/${f.formId}/fill${qs({ office, period: p.period_start })}`}
                      className={cn("rounded-full border-[1.5px] px-3 py-1 text-sm font-bold no-underline",
                        isOverdue(p.status, p.deadline) ? "border-r-overdue text-r-overdue-ink" : "border-r-line text-r-ink")}>
                      {dayMonth(p.period_start, lang)} · {t(`sub_${p.status}` as "sub_none")} {t("mine_open")}
                    </Link>
                  ))}
                </div>
              )}
              {flags.length > 0 && (
                <div className="flex flex-col gap-1 border-t border-r-sunk pt-2">
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
          )}
          <section className="grid grid-cols-2 gap-2.5">
            <RCard className="gap-0.5 rounded-[14px] p-3.5">
              <span className="text-[13px] font-bold text-r-muted">{t("days_sent")}</span>
              <span className="disp num text-[30px] font-bold">{periods.data ? sent.length : "–"}<span className="text-lg text-r-muted"> / {ps.length}</span></span>
              <span className="text-[13px] text-r-muted">{late > 0 ? tf("n_late", { n: late }) : " "}</span>
            </RCard>
            <RCard className="gap-0.5 rounded-[14px] p-3.5">
              <span className="text-[13px] font-bold text-r-muted">{t("fields_filled")}</span>
              <span className="disp num text-[30px] font-bold">{s ? `${Math.round(s.coverage.pct)}%` : "–"}</span>
              <span className="text-[13px] text-r-muted">{s ? tf("of_expected", { n: fig(s.coverage.expected_cells) }) : ""}</span>
            </RCard>
          </section>

          {field && <DayBars f={f} data={series.data} field={field.key} label={fieldLabel(field, lang)} columns={columns} pick={field.key} onPick={setPick} />}

          <RCard className="gap-0 rounded-[14px] px-4 pt-1.5 pb-2.5">
            <div className="flex justify-between gap-3 pt-2.5 pb-1.5 text-[13px] font-bold text-r-muted"><span>{t("field")}</span><span>{t("total_vs_prev")}</span></div>
            {peer.data && <span className="pb-1.5 text-xs text-r-muted">{t("mine_vs_div_hint")}</span>}
            {!s ? <div className="h-40 animate-pulse rounded-lg bg-r-sunk" /> : columns.map((c) => {
              const d = comparable ? deltaPct(s.totals[c.key], s.previous.totals[c.key]) : { text: "—", dir: 0 };
              const mine = perDay(c.key);
              const avg = peer.data?.per_day[c.key];
              return (
                <div key={c.key} className="flex items-center justify-between gap-3 border-t border-r-sunk py-[9px]">
                  <span className="flex flex-col">
                    <span className="text-[15px]">{fieldLabel(c, lang)}</span>
                    {avg !== undefined && avg !== null && (
                      <span className="num text-xs text-r-muted">
                        {t("mine_per_day")} <b className={cn(mine !== null && mine < avg ? "text-r-overdue-ink" : "text-r-ink")}>{fig(mine === null ? null : Math.round(mine * 10) / 10)}</b> · {t("mine_vs_div")} {fig(Math.round(avg * 10) / 10)}
                      </span>
                    )}
                  </span>
                  <span className="flex items-baseline gap-3">
                    <b className="num text-base">{fig(s.totals[c.key])}</b>
                    <span className={cn("num w-12 text-right text-[13px] font-semibold", d.dir > 0 ? "text-r-accepted" : d.dir < 0 ? "text-r-overdue-ink" : "text-r-muted")}>{d.text}</span>
                  </span>
                </div>
              );
            })}
          </RCard>
          <p className="mx-1 my-0 text-[13px] text-r-muted">{t("totals_note")}</p>
        </>
      )}
    </RPage>
  );
}

/** One bar per day for one field. A day with nothing counted is a dashed outline, never a zero-height bar. */
export function DayBars({ data, field, label, columns, pick, onPick, compare }: {
  f?: FormFilters; data?: SeriesPoint[]; field: string; label: string; columns: { key: string; label_mr: string; label_en: string }[];
  pick: string; onPick: (k: string) => void; compare?: SeriesPoint[];
}) {
  const { t, lang } = useT();
  const rows = data ?? [];
  const max = Math.max(1, ...rows.map((p) => (p.entered_cells ? p.values[field] ?? 0 : 0)), ...(compare ?? []).map((p) => p.values[field] ?? 0));
  const nice = niceMax(max);
  const H = 160;
  const counted = rows.filter((p) => p.entered_cells);
  const top = counted.reduce<SeriesPoint | null>((a, p) => (!a || (p.values[field] ?? 0) > (a.values[field] ?? 0) ? p : a), null);
  const many = rows.length > 16;
  return (
    <RCard className="gap-3 rounded-[14px] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-[17px] font-bold">{t("day_by_day")}</h2>
        <span className="text-sm text-r-muted">{label}</span>
      </div>
      <div role="group" aria-label={t("field")} className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-thin">
        {columns.map((c) => (
          <button key={c.key} type="button" aria-pressed={c.key === pick} onClick={() => onPick(c.key)}
            className={cn("min-h-10 flex-none cursor-pointer rounded-full border-[1.5px] px-3.5 text-sm font-bold",
              c.key === pick ? "border-r-ink bg-r-ink text-r-card" : "border-r-field bg-r-card text-r-ink")}>
            {fieldLabel(c, lang)}
          </button>
        ))}
      </div>
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
