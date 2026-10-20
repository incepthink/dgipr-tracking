import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Download } from "lucide-react";
import type { SheetTable } from "@/lib/api";
import { useT, type TKey } from "@/lib/i18n";
import { addDays, cn } from "@/lib/utils";
import { RAlert, RButton, RError, RFilterBar, RInput, RPage, RSegmented, RTitle } from "@/components/reports/kit";
import { stepOf } from "@/components/reports/period";
import { formTitle, scopeQs, useFormFilters } from "../forms/common";
import { CampaignSearch, DivisionPicker, FormStateChip, Stepper, formRange, formState } from "./shared";
import { ReportExportSheet, cellOut, groupStarts, isKind, isSubOffice, sheetTableQuery, type Kind } from "./ReportExport";

type Report = "daily" | "cumulative" | "datewise";
type Level = "division" | "district";

const kindOf = (report: Report, level: Level): Kind =>
  report === "datewise" ? "datewise" : `${report}_${level === "district" ? "office" : "division"}`;

/** The workbook's five tables on screen: pick a campaign, pick a date, read the table, send it on. */
export default function ReportsPage() {
  const { t, tf, lang } = useT();
  const f = useFormFilters(7);
  const form = f.form;
  const once = form?.frequency === "once";
  const [picking, setPicking] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  // view: ?table= keeps old links working; ?level= remembers the level while on date-wise
  const raw = f.params.get("table");
  let kind: Kind = isKind(raw) ? raw : "cumulative_division";
  if (once && !kind.startsWith("cumulative_")) kind = kind === "daily_office" ? "cumulative_office" : "cumulative_division";
  const report: Report = kind === "datewise" ? "datewise" : kind.startsWith("daily_") ? "daily" : "cumulative";
  const level: Level = kind === "datewise" ? (f.params.get("level") === "district" ? "district" : "division")
    : kind.endsWith("_office") ? "district" : "division";
  const setView = (r: Report, l: Level) => f.set({ table: kindOf(r, l), level: r === "datewise" ? l : null });

  // one as-of date; default the last closed day, always inside the form's range
  const lo = form?.start_date ?? "";
  const hi = f.lastDay;
  const clamp = (d: string) => (d < lo ? lo : d > hi ? hi : d);
  const asOf = form && f.today ? clamp(once ? hi : f.params.get("end") || addDays(f.today, -1)) : "";
  const step = form ? stepOf(form) : 1;
  const setAsOf = (d: string) => f.set({ end: clamp(d), start: null });

  // daily: the period holding as-of (the backend snaps); cumulative / date-wise: campaign start → as-of
  const scope = { ...f, start: report === "daily" ? asOf : lo, end: asOf };
  const ready = f.ready && !!asOf;
  const { data, error, isLoading, isFetching, isPlaceholderData } = useQuery({
    ...sheetTableQuery(f.formId, scopeQs(scope, { kind })), enabled: ready, placeholderData: (p) => p,
  });
  // phase 2: a cumulative table's total must equal the date-wise total for the same range
  const dw = useQuery({
    ...sheetTableQuery(f.formId, scopeQs({ ...scope, start: lo }, { kind: "datewise" })), enabled: ready && report === "cumulative",
  });

  const dailyLabel = form?.frequency === "weekly" ? t("rep_weekly") : t("rep_daily");
  const reports: { value: Report; label: string }[] = once ? [{ value: "cumulative", label: t("rep_cumulative") }] : [
    { value: "daily", label: dailyLabel }, { value: "cumulative", label: t("rep_cumulative") }, { value: "datewise", label: t("rep_datewise") },
  ];

  return (
    <RPage>
      <RTitle title={t("nav_reports")} sub={t("rep_desc")} />

      {/* campaign bar */}
      {f.forms && !f.forms.length ? <RAlert tone="info">{t("no_forms")}</RAlert> : (
        <div className="flex flex-col gap-3 rounded-2xl bg-r-card p-3 sm:flex-row sm:items-center sm:px-5">
          <button type="button" aria-haspopup="dialog" aria-label={`${t("cs_change")}: ${formTitle(form, lang)}`} disabled={!f.forms}
            onClick={() => setPicking(true)}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl border-[1.5px] border-r-line bg-r-card px-3.5 py-2.5 text-left text-r-ink hover:bg-r-sunk disabled:cursor-wait">
            {form ? (
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <b className="text-lg leading-tight wrap-break-word">{formTitle(form, lang)}</b>
                  <FormStateChip state={formState(form, f.today)} />
                </span>
                <span className="text-sm text-r-muted"><span className="num">{formRange(form, lang)}</span> · {t(`freq_${form.frequency}` as TKey)}</span>
              </span>
            ) : <span className="h-12 flex-1 animate-pulse rounded-lg bg-r-sunk" />}
            <ChevronDown className="size-5 shrink-0 text-r-muted" aria-hidden />
          </button>
          <RButton variant="pri" disabled={!ready} onClick={() => setExporting(true)}><Download aria-hidden />{t("export")}</RButton>
        </div>
      )}

      {/* view controls */}
      <RFilterBar>
        <Ctl label={t("rep_report")}>
          <RSegmented label={t("rep_report")} value={report} options={reports} onChange={(r) => setView(r, level)} />
        </Ctl>
        {report !== "datewise" && (
          <Ctl label={t("rep_level")}>
            <RSegmented label={t("rep_level")} value={level} onChange={(l) => setView(report, l)}
              options={[{ value: "division", label: t("lvl_division") }, { value: "district", label: t("lvl_district") }]} />
          </Ctl>
        )}
        {!once && (
          <div className="flex flex-col gap-1">
            <label htmlFor="rep-as-of" className="text-[13px] font-bold text-r-muted">{t("as_of")}</label>
            <Stepper prevOk={!!asOf && asOf > lo} nextOk={!!asOf && asOf < hi}
              onPrev={() => setAsOf(addDays(asOf, -step))} onNext={() => setAsOf(addDays(asOf, step))}
              label={<RInput id="rep-as-of" type="date" className="num w-auto font-normal" value={asOf} min={lo} max={hi}
                disabled={!asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />} />
          </div>
        )}
        <DivisionPicker f={f} />
      </RFilterBar>

      {error ? <RError error={error} /> : (
        <section className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-0.5">
            <h2 className="disp m-0 text-[22px] leading-tight font-bold sm:text-[26px]">{data?.title ?? " "}</h2>
            <span className="text-r-muted">{data?.subtitle ?? " "}</span>
          </div>
          {isLoading || !data ? <div className="h-96 animate-pulse rounded-xl bg-r-sunk" />
            : !data.rows.length ? <RAlert tone="info">{t("no_data_range")}</RAlert>
            : <Sheet data={data} dim={isFetching} />}
          {data && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-r-muted">
              <span>{tf("rows_n", { n: data.rows.length })}</span>
              <span>{t("blank_vs_zero")}</span>
              {report === "cumulative" && !isPlaceholderData && dw.data && !dw.isPlaceholderData && <Reconcile a={data} b={dw.data} />}
            </div>
          )}
        </section>
      )}

      <CampaignSearch f={f} open={picking} onClose={() => setPicking(false)} />
      <ReportExportSheet f={f} open={exporting} onClose={() => setExporting(false)} kind={kind} asOf={asOf} />
    </RPage>
  );
}

/** A small label over a control group (a <label> would forward clicks to its first button). */
function Ctl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1">
      <span className="text-[13px] font-bold text-r-muted" aria-hidden>{label}</span>
      {children}
    </div>
  );
}

/** The sheet as on screen: sticky header, first column and total row; district groups set apart. */
function Sheet({ data, dim }: { data: SheetTable; dim: boolean }) {
  const { t } = useT();
  const tc = data.text_cols;
  const district = tc === 2;
  return (
    <div className={cn("max-h-[75vh] overflow-auto rounded-xl border border-r-line bg-r-card scrollbar-thin transition-opacity", dim && "opacity-60")}>
      <table className="w-full border-separate border-spacing-0 text-sm" aria-label={`${data.title} · ${data.subtitle}`}>
        <thead className="sticky top-0 z-20">
          <tr>
            {data.header.map((h, i) => (
              <th key={i} scope="col" className={cn("border-b-[1.5px] border-r-ink bg-r-card px-2.5 py-2 align-bottom text-xs leading-tight font-bold text-r-muted",
                i < tc ? "min-w-24 text-left" : "min-w-18 text-right", i === 0 && "sticky left-0 z-30")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, ri) => {
            const first = groupStarts(data, ri);
            const sub = district && isSubOffice(r[1]);
            return (
              <tr key={ri} className="group">
                {r.map((v, i) => {
                  // nothing entered behind this cell: the sheet prints 0, the screen says "not reported"
                  const blank = i >= tc && data.blank?.[ri]?.[i - tc];
                  const out = blank ? <span className="text-r-faint" title={t("not_counted")}>–</span> : cellOut(v, i >= tc);
                  return (
                    <td key={i} className={cn("border-b border-r-line-soft px-2.5 py-1.5 group-hover:bg-r-ground",
                      i < tc ? "whitespace-nowrap" : "num text-right",
                      i === 0 && "sticky left-0 bg-r-card font-medium",
                      district && first && ri > 0 && "border-t border-t-r-line",
                      district && i === 1 && sub && "text-[13px] text-r-muted")}>
                      {district && i === 0 ? (first ? out : null) : out ?? <span className="text-r-faint">—</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot className="sticky bottom-0 z-20">
          <tr>
            {data.total.map((v, i) => (
              <td key={i} className={cn("border-t-[1.5px] border-r-ink bg-r-sunk px-2.5 py-2 font-bold", i < tc ? "whitespace-nowrap" : "num text-right", i === 0 && "sticky left-0 z-30")}>
                {i < tc ? v : cellOut(v, true)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Cumulative total vs the date-wise total for the same range, column by column. */
function Reconcile({ a, b }: { a: SheetTable; b: SheetTable }) {
  const { t, tf } = useT();
  if (a.start !== b.start || a.end !== b.end) return null;
  const av = a.total.slice(a.text_cols), bv = b.total.slice(b.text_cols);
  if (av.length !== bv.length) return null;
  const diff = av.map((v, i) => (Math.abs((Number(v) || 0) - (Number(bv[i]) || 0)) > 1e-6 ? a.header[a.text_cols + i] : null)).filter(Boolean);
  return diff.length
    ? <span className="font-bold text-r-overdue-ink" role="status">{tf("reconcile_bad", { cols: diff.join(", ") })}</span>
    : <span className="font-bold text-r-accepted" role="status">{t("reconcile_ok")}</span>;
}
