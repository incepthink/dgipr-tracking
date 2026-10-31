import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronDown, Download } from "lucide-react";
import type { SheetTable } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { useT, type TKey } from "@/lib/i18n";
import { addDays, cn } from "@/lib/utils";
import { RAlert, RButton, RError, RFilterBar, RPage, RSegmented, RTitle } from "@/components/reports/kit";
import { DateInput } from "@/components/reports/DateInput";
import { DateRangeInput, type RangePreset } from "@/components/reports/DateRangeInput";
import { rangeText, stepOf } from "@/components/reports/period";
import { formTitle, scopeQs, sumColumns, useFormFilters } from "../forms/common";
import { CampaignSearch, DivisionPicker, FormStatusChip, OfficePicker, Stepper, formRange } from "./shared";
import { ReportExportSheet, cellOut, groupStarts, isKind, isSubOffice, sheetTableQuery, type Kind } from "./ReportExport";

type Report = "cumulative" | "datewise";
type Level = "division" | "district";
/** Row order: official (config/organisation.yaml), or by the chosen column, highest or lowest first. */
type Order = "official" | "desc" | "asc";

const kindOf = (report: Report, level: Level): Kind =>
  report === "datewise" ? "datewise" : `${report}_${level === "district" ? "office" : "division"}`;

/** The workbook's five tables on screen: pick a campaign, pick a date, read the table, send it on. */
export default function ReportsPage() {
  const { t, tf, lang } = useT();
  const me = useUser();
  const f = useFormFilters(7);
  const form = f.form;
  const once = form?.frequency === "once";
  const [picking, setPicking] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  // view: ?table= keeps old links working; ?level= remembers the level while on date-wise
  const raw = f.params.get("table");
  let kind: Kind = isKind(raw) ? raw : "cumulative_division";
  // the screen shows only the cumulative and date-wise tables; old links to a daily table open its cumulative one
  if (kind.startsWith("daily_")) kind = kind.replace("daily_", "cumulative_") as Kind;
  if (once && kind === "datewise") kind = "cumulative_division";
  // a district office only sees its own district, so it always reads the district-level tables
  const districtOnly = me.role === "district";
  if (districtOnly && kind.endsWith("_division")) kind = kind.replace("_division", "_office") as Kind;
  const report: Report = kind === "datewise" ? "datewise" : "cumulative";
  const level: Level = districtOnly ? "district" : kind === "datewise" ? (f.params.get("level") === "district" ? "district" : "division")
    : kind.endsWith("_office") ? "district" : "division";
  // a division-level table sums whole divisions, so a single-office filter only applies to district / date-wise
  const setView = (r: Report, l: Level) => f.set({ table: kindOf(r, l), level: r === "datewise" ? l : null,
    ...(r !== "datewise" && l === "division" ? { office: null } : {}) });
  const officeOk = report === "datewise" || level === "district";

  // the column the sort uses (picked by clicking its heading) and the order
  const cols = sumColumns(form);
  const col = cols.find((c) => c.key === f.params.get("col")) ?? cols[0];
  const order: Order = (["desc", "asc"] as const).find((o) => o === f.params.get("order")) ?? "official";
  const sortQs = { sort: order !== "official" ? col?.key : undefined, order: order !== "official" ? order : undefined };

  // cumulative: a from–to range (default campaign start → the last closed day); date-wise: campaign start → as-of
  const lo = form?.start_date ?? "";
  const hi = f.lastDay;
  const clamp = (d: string) => (d < lo ? lo : d > hi ? hi : d);
  const asOf = form && f.today ? clamp(once ? hi : f.params.get("end") || addDays(f.today, -1)) : "";
  const step = form ? stepOf(form) : 1;
  const setAsOf = (d: string) => f.set({ end: clamp(d), start: null });
  const from = report === "cumulative" && asOf ? clamp(f.params.get("start") || lo) : lo;
  const start = from > asOf ? lo : from;
  const presets: RangePreset[] = !form || !asOf ? [] : [
    { label: t("rng_all"), start: lo, end: hi },
    { label: t("last7"), start: clamp(addDays(hi, -6)), end: hi },
    { label: t("last30"), start: clamp(addDays(hi, -29)), end: hi },
  ];

  const scope = { ...f, office: officeOk ? f.office : "", start, end: asOf };
  const ready = f.ready && !!asOf;
  const { data, error, isLoading, isFetching, isPlaceholderData } = useQuery({
    ...sheetTableQuery(f.formId, scopeQs(scope, { kind, ...sortQs })), enabled: ready, placeholderData: (p) => p,
  });
  // phase 2: a cumulative table's total must equal the date-wise total for the same range
  const dw = useQuery({
    ...sheetTableQuery(f.formId, scopeQs(scope, { kind: "datewise" })), enabled: ready && report === "cumulative",
  });

  const reports: { value: Report; label: string }[] = once ? [{ value: "cumulative", label: t("rep_cumulative") }] : [
    { value: "cumulative", label: t("rep_cumulative") }, { value: "datewise", label: t("rep_datewise") },
  ];

  return (
    <RPage>
      <RTitle title={t("nav_reports")} />

      {/* campaign bar */}
      {f.forms && !f.forms.length ? <RAlert tone="info">{t("no_forms")}</RAlert> : (
        <div className="flex flex-col gap-3 rounded-2xl bg-r-card p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
          <button type="button" aria-haspopup="dialog" aria-label={`${t("cs_change")}: ${formTitle(form, lang)}`} disabled={!f.forms}
            onClick={() => setPicking(true)}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl border-[1.5px] border-r-line bg-r-card px-3.5 py-2.5 text-left text-r-ink hover:bg-r-sunk disabled:cursor-wait">
            {form ? (
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <b className="text-lg leading-tight wrap-break-word">{formTitle(form, lang)}</b>
                  <FormStatusChip status={form.status} />
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
      <RFilterBar className="gap-x-6 gap-y-4 py-4">
        <Ctl label={t("rep_report")}>
          <RSegmented label={t("rep_report")} value={report} options={reports} onChange={(r) => setView(r, level)} />
        </Ctl>
        {report !== "datewise" && !districtOnly && (
          <Ctl label={t("rep_level")}>
            <RSegmented label={t("rep_level")} value={level} onChange={(l) => setView(report, l)}
              options={[{ value: "division", label: t("lvl_division") }, { value: "district", label: t("lvl_district") }]} />
          </Ctl>
        )}
        {!once && report === "cumulative" && (
          <div className="flex flex-col gap-1">
            <label htmlFor="rep-range" className="text-[13px] font-bold text-r-muted">{t("rng_label")}</label>
            <DateRangeInput id="rep-range" value={{ start, end: asOf }} min={lo} max={hi} presets={presets}
              onChange={(x) => f.set({ start: x.start === lo ? null : clamp(x.start), end: clamp(x.end) })} />
          </div>
        )}
        {!once && report === "datewise" && (
          <div className="flex flex-col gap-1">
            <label htmlFor="rep-as-of" className="text-[13px] font-bold text-r-muted">{t("as_of")}</label>
            <Stepper prevOk={!!asOf && asOf > lo} nextOk={!!asOf && asOf < hi}
              onPrev={() => setAsOf(addDays(asOf, -step))} onNext={() => setAsOf(addDays(asOf, step))}
              label={<DateInput id="rep-as-of" className="font-normal" value={asOf} min={lo} max={hi}
                disabled={!asOf} onChange={(d) => d && setAsOf(d)} />} />
          </div>
        )}
        <DivisionPicker f={f} />
        {officeOk && <OfficePicker f={f} />}
      </RFilterBar>

      {/* the order; a heading click picks the column it sorts by */}
      <RFilterBar className="gap-x-6 gap-y-4 py-4">
        <Ctl label={t("rep_order")}>
          <RSegmented label={t("rep_order")} value={order} onChange={(o) => f.set({ order: o === "official" ? null : o })}
            options={[{ value: "official", label: t("ord_official") }, { value: "desc", label: t("ord_desc") }, { value: "asc", label: t("ord_asc") }]} />
        </Ctl>
      </RFilterBar>

      {error ? <RError error={error} /> : (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col items-start gap-2">
            <h2 className="disp m-0 text-[22px] leading-tight font-bold sm:text-[26px]">{data?.title ?? " "}</h2>
            {/* the dates picked, straight from the controls (the table's own subtitle lags while it loads) */}
            {start && asOf
              ? <span className="num inline-flex items-center rounded-full bg-r-action-soft px-4 py-1.5 text-base font-bold text-r-action sm:text-[17px]">
                  {lang === "mr" ? "दि. " : ""}{rangeText(start, asOf, lang)}
                </span>
              : <span className="h-9 w-48 animate-pulse rounded-full bg-r-sunk" />}
          </div>
          {isLoading || !data ? <div className="h-96 animate-pulse rounded-xl bg-r-sunk" />
            : !data.rows.length ? <RAlert tone="info">{t("no_data_range")}</RAlert>
            : <Sheet data={data} dim={isFetching} col={col ? cols.indexOf(col) : -1} order={order}
                onCol={(j) => {
                  // the sorted column cycles highest first → lowest first → official order; another column starts at highest first
                  const same = order !== "official" && cols[j]?.key === col?.key;
                  f.set({ col: cols[j]?.key, order: !same ? "desc" : order === "desc" ? "asc" : null });
                }} />}
          {data && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 text-[13px] text-r-muted">
              <span>{tf("rows_n", { n: data.rows.length })}</span>
              <span>{t("blank_vs_zero")}</span>
              {report === "cumulative" && !isPlaceholderData && dw.data && !dw.isPlaceholderData && <Reconcile a={data} b={dw.data} />}
            </div>
          )}
        </section>
      )}

      <CampaignSearch f={f} open={picking} onClose={() => setPicking(false)} />
      <ReportExportSheet f={{ ...f, office: officeOk ? f.office : "" }} open={exporting} onClose={() => setExporting(false)}
        kind={kind} asOf={asOf} start={start} sort={sortQs} />
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
function Sheet({ data, dim, col, order, onCol }: {
  data: SheetTable; dim: boolean;
  /** The sort column (0-based among the value columns), the row order, and how to pick another column. */
  col: number; order: Order; onCol: (j: number) => void;
}) {
  const { t, tf } = useT();
  const tc = data.text_cols;
  const district = tc === 2;
  return (
    <div className={cn("max-h-[75vh] overflow-auto rounded-xl border border-r-line bg-r-card scrollbar-thin transition-opacity", dim && "opacity-60")}>
      <table className="w-full border-separate border-spacing-0 text-sm" aria-label={`${data.title} · ${data.subtitle}`}>
        <thead className="sticky top-0 z-20">
          <tr>
            {data.header.map((h, i) => (
              <th key={i} scope="col" className={cn("border-b-[1.5px] border-r-ink bg-r-card px-4 py-3 align-bottom text-xs leading-snug font-bold text-r-muted",
                i < tc ? "min-w-32 text-left" : "min-w-24 text-right", i === 0 && "sticky left-0 z-30 pl-5", i === data.header.length - 1 && "pr-5")}
                aria-sort={i - tc === col && order !== "official" ? (order === "asc" ? "ascending" : "descending") : undefined}>
                {i < tc ? h : (
                  <button type="button" onClick={() => onCol(i - tc)} title={tf("sort_by", { f: String(h) })}
                    className={cn("-mx-1.5 inline-flex cursor-pointer items-end justify-end gap-1 rounded-md border-0 px-1.5 py-0.5 text-right font-[inherit] leading-[inherit]",
                      i - tc === col && order !== "official" ? "bg-r-action-soft text-r-action" : "bg-transparent text-inherit hover:bg-r-sunk hover:text-r-ink")}>
                    {h}
                    {i - tc === col && order !== "official" && (order === "asc" ? <ArrowUp className="size-3 shrink-0" aria-hidden /> : <ArrowDown className="size-3 shrink-0" aria-hidden />)}
                  </button>
                )}
              </th>
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
                    <td key={i} className={cn("border-b border-r-line-soft px-4 py-2.5 group-hover:bg-r-ground",
                      i === 0 && "pl-5", i === r.length - 1 && "pr-5",
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
              <td key={i} className={cn("border-t-[1.5px] border-r-ink bg-r-sunk px-4 py-3 font-bold", i < tc ? "whitespace-nowrap" : "num text-right", i === 0 && "sticky left-0 z-30 pl-5", i === data.total.length - 1 && "pr-5")}>
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
