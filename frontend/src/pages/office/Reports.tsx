import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Download } from "lucide-react";
import type { SheetTable } from "@/lib/api";
import { useT, type TKey } from "@/lib/i18n";
import { addDays, cn } from "@/lib/utils";
import { RAlert, RButton, RCard, RCardTitle, RError, RFilterBar, RInput, RLabel, RPage, RSegmented, RSelect, RStat, RTitle } from "@/components/reports/kit";
import { fig, stepOf } from "@/components/reports/period";
import { fieldLabel, formTitle, scopeQs, sumColumns, useFormFilters } from "../forms/common";
import { CampaignSearch, DivisionPicker, FormStateChip, OfficePicker, Stepper, formRange, formState } from "./shared";
import { ReportExportSheet, cellOut, groupStarts, isKind, isSubOffice, sheetTableQuery, type Kind } from "./ReportExport";

type Report = "daily" | "cumulative" | "datewise";
type Level = "division" | "district";
/** Row order: official (config/organisation.yaml), or by the chosen column, highest or lowest first. */
type Order = "official" | "desc" | "asc";
type View = "table" | "chart";

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
  // a division-level table sums whole divisions, so a single-office filter only applies to district / date-wise
  const setView = (r: Report, l: Level) => f.set({ table: kindOf(r, l), level: r === "datewise" ? l : null,
    ...(r !== "datewise" && l === "division" ? { office: null } : {}) });
  const officeOk = report === "datewise" || level === "district";

  // the column the chart, the statistics and the sort use; the order; table or chart
  const cols = sumColumns(form);
  const col = cols.find((c) => c.key === f.params.get("col")) ?? cols[0];
  const order: Order = (["desc", "asc"] as const).find((o) => o === f.params.get("order")) ?? "official";
  const view: View = f.params.get("view") === "chart" ? "chart" : "table";
  const sortQs = { sort: order !== "official" ? col?.key : undefined, order: order !== "official" ? order : undefined };

  // one as-of date; default the last closed day, always inside the form's range
  const lo = form?.start_date ?? "";
  const hi = f.lastDay;
  const clamp = (d: string) => (d < lo ? lo : d > hi ? hi : d);
  const asOf = form && f.today ? clamp(once ? hi : f.params.get("end") || addDays(f.today, -1)) : "";
  const step = form ? stepOf(form) : 1;
  const setAsOf = (d: string) => f.set({ end: clamp(d), start: null });

  // daily: the period holding as-of (the backend snaps); cumulative / date-wise: campaign start → as-of
  const scope = { ...f, office: officeOk ? f.office : "", start: report === "daily" ? asOf : lo, end: asOf };
  const ready = f.ready && !!asOf;
  const { data, error, isLoading, isFetching, isPlaceholderData } = useQuery({
    ...sheetTableQuery(f.formId, scopeQs(scope, { kind, ...sortQs })), enabled: ready, placeholderData: (p) => p,
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
        {officeOk && <OfficePicker f={f} />}
      </RFilterBar>

      {/* one column drives the sort, the chart and the statistics */}
      <RFilterBar>
        {cols.length > 0 && (
          <RLabel small label={t("rep_measure")}>
            <RSelect value={col?.key} className="max-w-64" onChange={(e) => f.set({ col: e.target.value })}>
              {cols.map((c) => <option key={c.key} value={c.key}>{fieldLabel(c, lang)}</option>)}
            </RSelect>
          </RLabel>
        )}
        <Ctl label={t("rep_order")}>
          <RSegmented label={t("rep_order")} value={order} onChange={(o) => f.set({ order: o === "official" ? null : o })}
            options={[{ value: "official", label: t("ord_official") }, { value: "desc", label: t("ord_desc") }, { value: "asc", label: t("ord_asc") }]} />
        </Ctl>
        <Ctl label={t("rep_view")}>
          <RSegmented label={t("rep_view")} value={view} onChange={(v) => f.set({ view: v === "table" ? null : v })}
            options={[{ value: "table", label: t("view_table") }, { value: "chart", label: t("view_chart") }]} />
        </Ctl>
      </RFilterBar>

      {error ? <RError error={error} /> : (
        <section className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-0.5">
            <h2 className="disp m-0 text-[22px] leading-tight font-bold sm:text-[26px]">{data?.title ?? " "}</h2>
            <span className="text-r-muted">{data?.subtitle ?? " "}</span>
          </div>
          {isLoading || !data ? <div className="h-96 animate-pulse rounded-xl bg-r-sunk" />
            : !data.rows.length ? <RAlert tone="info">{t("no_data_range")}</RAlert>
            : <>
              {col && <Stats data={data} colIndex={data.text_cols + cols.indexOf(col)} label={fieldLabel(col, lang)} />}
              {view === "chart" && col
                ? <BarsChart data={data} colIndex={data.text_cols + cols.indexOf(col)} label={fieldLabel(col, lang)} dim={isFetching} />
                : <Sheet data={data} dim={isFetching} />}
            </>}
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
      <ReportExportSheet f={{ ...f, office: officeOk ? f.office : "" }} open={exporting} onClose={() => setExporting(false)}
        kind={kind} asOf={asOf} sort={sortQs} />
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

/** What a row is called: the office for district tables, else the division or the date. */
const rowName = (data: SheetTable, r: (string | number)[]) => String(data.text_cols === 2 ? r[1] : r[0]);

function rowsOf(data: SheetTable, colIndex: number) {
  const j = colIndex - data.text_cols;
  return data.rows.map((r, i) => ({ name: rowName(data, r), v: Number(r[colIndex]) || 0, blank: !!data.blank?.[i]?.[j] }));
}

/** Statistics for one column over the rows shown: total, average, highest, lowest, rows with figures. */
function Stats({ data, colIndex, label }: { data: SheetTable; colIndex: number; label: string }) {
  const { t, tf } = useT();
  const rows = rowsOf(data, colIndex);
  const reported = rows.filter((r) => !r.blank);
  if (!reported.length) return null;
  const total = Number(data.total[colIndex]) || 0;
  const hi = reported.reduce((a, b) => (b.v > a.v ? b : a));
  const lo = reported.reduce((a, b) => (b.v < a.v ? b : a));
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5" role="group" aria-label={tf("stats_of", { col: label })}>
      <RStat label={tf("stat_total", { col: label })} value={fig(total)} />
      <RStat label={t("stat_average")} value={fig(Math.round((total / reported.length) * 10) / 10)} sub={t("stat_average_sub")} />
      <RStat label={t("stat_highest")} value={fig(hi.v)} sub={<span className="wrap-break-word">{hi.name}</span>} />
      <RStat label={t("stat_lowest")} value={fig(lo.v)} sub={<span className="wrap-break-word">{lo.name}</span>} />
      <RStat label={t("stat_reported")} value={reported.length} of={rows.length} progress={(100 * reported.length) / rows.length} />
    </div>
  );
}

/** One horizontal bar per table row, in the table's order, for the chosen column. Nothing entered is a dashed
 * outline, never a zero bar (as in TrendBars); the figure sits at the end of each bar. */
function BarsChart({ data, colIndex, label, dim }: { data: SheetTable; colIndex: number; label: string; dim: boolean }) {
  const { t } = useT();
  const rows = rowsOf(data, colIndex);
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <RCard className={cn("transition-opacity", dim && "opacity-60")}>
      <RCardTitle>{label}</RCardTitle>
      <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={label}>
        {rows.map((r, i) => (
          <li key={i} tabIndex={0} title={`${r.name}: ${r.blank ? t("map_not_reported") : fig(r.v)}`}
            className="group grid grid-cols-[minmax(6rem,14rem)_1fr] items-center gap-3 rounded-md px-1 py-0.5 outline-none hover:bg-r-ground focus-visible:bg-r-ground">
            <span className={cn("truncate text-sm", isSubOffice(r.name) && "text-r-muted")}>{r.name}</span>
            <span className="flex min-w-0 items-center gap-2">
              {r.blank
                ? <span className="h-4 w-6 shrink-0 rounded-r border-[1.5px] border-l-0 border-dashed border-r-faint" aria-hidden />
                : <span className="h-4 shrink-0 rounded-r bg-r-action group-hover:opacity-85" style={{ width: `${r.v ? Math.max(0.5, (r.v / max) * 80) : 0}%` }} aria-hidden />}
              <span className="num text-sm font-bold">{r.blank ? <span className="font-normal text-r-faint">{t("map_not_reported")}</span> : fig(r.v)}</span>
            </span>
          </li>
        ))}
      </ul>
    </RCard>
  );
}
