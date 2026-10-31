import * as React from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Printer } from "lucide-react";
import { api, backendUrl, type SheetTable } from "@/lib/api";
import { useMeta } from "@/lib/hooks";
import { useUser } from "@/lib/auth";
import { useT, type TKey } from "@/lib/i18n";
import { addDays, cn } from "@/lib/utils";
import { RAlert, RButton, RCheck, RInput, RLabel, RSelect, RSheet } from "@/components/reports/kit";
import { fig, periodEnd, periodOf, rangeText } from "@/components/reports/period";
import { formTitle, scopeQs, type FormFilters } from "../forms/common";

// --------------------------------------------------------------------------- the five tables
export const KINDS = ["daily_division", "daily_office", "cumulative_division", "cumulative_office", "datewise"] as const;
export type Kind = (typeof KINDS)[number];

export const isKind = (k: string | null): k is Kind => !!k && (KINDS as readonly string[]).includes(k);

/** One table for one scope; the page and the print path share the cache key. */
export function sheetTableQuery(formId: number, qs: string) {
  return {
    queryKey: ["sheet-table", formId, qs] as const,
    queryFn: () => api.get<SheetTable>(`/api/forms/${formId}/analytics/table${qs}`),
  };
}

/** Figures as the sheet shows them (0, never a dash); empty text cells come back null. */
export function cellOut(v: string | number | null | undefined, numeric: boolean) {
  if (numeric) return fig(typeof v === "number" ? v : Number(v) || 0);
  return v === "" || v === null || v === undefined ? null : String(v);
}

/** District tables (two text columns): the division name only on the first row of its group. */
export const groupStarts = (t: SheetTable, ri: number) => t.text_cols === 2 && (ri === 0 || t.rows[ri - 1][0] !== t.rows[ri][0]);

/** RIO / director / headquarters rows, set apart from the districts. */
export const isSubOffice = (name: string | number) => /विमाका|संचालक|मुख्यालय/.test(String(name));

// --------------------------------------------------------------------------- export sheet
type What = Kind | "workbook";
type Preset = "campaign" | "last7" | "custom";
type Fmt = "xlsx" | "csv" | "print";

const FMT_LABEL: Record<Fmt, TKey> = { xlsx: "fmt_excel", csv: "fmt_csv", print: "fmt_print" };

/** Pick a table (or the whole workbook), its dates, division and format; pre-filled from the screen. */
export function ReportExportSheet({ f, open, onClose, kind, asOf, sort }: {
  f: FormFilters; open: boolean; onClose: () => void; kind: Kind; asOf: string;
  /** The screen's row order (column + asc/desc); tables export in that order. */
  sort?: { sort?: string; order?: string };
}) {
  const { t, tf, lang } = useT();
  const me = useUser();
  const { data: meta } = useMeta();
  const qc = useQueryClient();
  const form = f.form;
  const once = form?.frequency === "once";
  const lo = form?.start_date ?? "";
  const hi = f.lastDay;

  const [what, setWhat] = React.useState<What>(kind);
  const [day, setDay] = React.useState(asOf);
  const [preset, setPreset] = React.useState<Preset>("campaign");
  const [from, setFrom] = React.useState(lo);
  const [to, setTo] = React.useState(asOf);
  const [division, setDivision] = React.useState(f.division);
  const [fmt, setFmt] = React.useState<Fmt>("xlsx");
  const [busy, setBusy] = React.useState(false);
  const [printing, setPrinting] = React.useState<SheetTable | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setWhat(kind); setDay(asOf); setPreset("campaign"); setFrom(lo); setTo(asOf); setDivision(f.division); setFmt("xlsx");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // print the fetched table, then put the page back
  React.useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(null);
    document.body.classList.add("rpt-printing");
    window.addEventListener("afterprint", done);
    const id = requestAnimationFrame(() => window.print());
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("afterprint", done);
      document.body.classList.remove("rpt-printing");
    };
  }, [printing]);

  const kinds = KINDS.filter((k) => !once || k.startsWith("cumulative_"));
  const daily = what !== "workbook" && what.startsWith("daily_");
  const clampDay = (d: string) => (d < lo ? lo : d > hi ? hi : d);
  const range = daily ? { start: day, end: day }
    : preset === "campaign" ? { start: lo, end: asOf }
    : preset === "last7" ? { start: addDays(asOf, -6) < lo ? lo : addDays(asOf, -6), end: asOf }
    : { start: from, end: to };
  const badRange = !range.start || !range.end || range.start > range.end;
  // the screen's office filter holds while the division is unchanged and the table is per office or date-wise
  const office = division === f.division && (what === "workbook" || what === "datewise" || what.endsWith("_office")) ? f.office : "";
  const scope = { ...f, start: range.start, end: range.end, division, office };
  const fmtOk = (x: Fmt) => what !== "workbook" || x === "xlsx";
  const href = what === "workbook"
    ? `/api/forms/${f.formId}/export${scopeQs(scope)}`
    : `/api/forms/${f.formId}/analytics/export${scopeQs(scope, { kind: what, format: fmt, ...sort })}`;
  // a daily table covers the whole period holding the date (a week, for weekly forms)
  const shown = daily && form ? { start: periodOf(form, day), end: periodEnd(form, periodOf(form, day)) } : range;
  const whatLabel = what === "workbook" ? t("exp_workbook") : t(`t_${what}` as TKey);
  const summary = `${formTitle(form, lang)} — ${whatLabel} · ${badRange ? "—" : rangeText(shown.start, shown.end, lang)} · ${fmt === "print" ? t("fmt_print") : fmt.toUpperCase()}`;

  const chooseWhat = (w: What) => {
    setWhat(w);
    if (w === "workbook") setFmt("xlsx");
  };

  const print = async () => {
    if (what === "workbook") return;
    setBusy(true);
    try {
      const data = await qc.fetchQuery(sheetTableQuery(f.formId, scopeQs(scope, { kind: what, ...sort })));
      onClose();
      setPrinting(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <>
      <p className="m-0 text-sm text-r-muted" aria-live="polite">{summary}</p>
      {badRange || !f.ready ? (
        <RButton variant="pri" size="lg" disabled>{fmt === "print" ? <Printer aria-hidden /> : <Download aria-hidden />}{fmt === "print" ? t("print") : t("download")}</RButton>
      ) : fmt === "print" ? (
        <RButton variant="pri" size="lg" loading={busy} onClick={print}><Printer aria-hidden />{t("print")}</RButton>
      ) : (
        <RButton asChild variant="pri" size="lg"><a href={backendUrl(href)} download><Download aria-hidden />{t("download")}</a></RButton>
      )}
    </>
  );

  return (
    <>
      <RSheet open={open} onClose={onClose} closeLabel={t("close")} title={t("exp_title")} description={formTitle(form, lang)} footer={footer} wide>
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1.5 p-0 font-bold">{t("exp_what")}</legend>
          <div role="radiogroup" aria-label={t("exp_what")} className="flex flex-col gap-2">
            {[...kinds, "workbook" as const].map((k) => (
              <RCheck key={k} radio plain checked={what === k} onChange={() => chooseWhat(k)} className="min-h-9 text-[15px]">
                {k === "workbook" ? t("exp_workbook") : t(`t_${k}` as TKey)}
              </RCheck>
            ))}
          </div>
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
          <legend className="mb-1.5 p-0 font-bold">{t("exp_dates")}</legend>
          {daily ? (
            <RLabel small label={t("date")} className="self-start">
              <RInput type="date" value={day} min={lo} max={hi} onChange={(e) => e.target.value && setDay(clampDay(e.target.value))} />
            </RLabel>
          ) : (
            <>
              <div role="radiogroup" aria-label={t("exp_dates")} className="flex flex-wrap gap-2">
                <RCheck radio checked={preset === "campaign"} onChange={() => setPreset("campaign")}>{tf("preset_campaign", { date: rangeText(asOf, asOf, lang) })}</RCheck>
                {!once && <RCheck radio checked={preset === "last7"} onChange={() => setPreset("last7")}>{t("last7")}</RCheck>}
                <RCheck radio checked={preset === "custom"} onChange={() => setPreset("custom")}>{t("preset_custom")}</RCheck>
              </div>
              {preset === "custom" && (
                <div className="flex flex-wrap gap-3">
                  <RLabel small label={t("from")}>
                    <RInput type="date" value={from} min={lo} max={hi} onChange={(e) => e.target.value && setFrom(clampDay(e.target.value))} aria-invalid={badRange || undefined} />
                  </RLabel>
                  <RLabel small label={t("to")}>
                    <RInput type="date" value={to} min={lo} max={hi} onChange={(e) => e.target.value && setTo(clampDay(e.target.value))} aria-invalid={badRange || undefined} />
                  </RLabel>
                </div>
              )}
              {badRange && <RAlert tone="danger">{t("exp_bad_range")}</RAlert>}
            </>
          )}
        </fieldset>

        {me.role === "state" && (
          <RLabel small label={t("division")} className="self-start">
            <RSelect value={division} onChange={(e) => setDivision(e.target.value)}>
              <option value="">{t("all_divisions")}</option>
              {meta?.divisions.map((d) => <option key={d.code} value={d.code}>{d.label_mr}</option>)}
            </RSelect>
          </RLabel>
        )}

        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1.5 p-0 font-bold">{t("exp_format")}</legend>
          <div role="radiogroup" aria-label={t("exp_format")} className="flex flex-wrap gap-2">
            {(["xlsx", "csv", "print"] as const).map((x) => (
              <RCheck key={x} radio checked={fmt === x} disabled={!fmtOk(x)} onChange={() => setFmt(x)}>{t(FMT_LABEL[x])}</RCheck>
            ))}
          </div>
          {what === "workbook" && <span className="text-sm text-r-muted">{t("exp_table_only")}</span>}
        </fieldset>
      </RSheet>
      {printing && createPortal(<PrintSheet data={printing} />, document.body)}
    </>
  );
}

// --------------------------------------------------------------------------- print
/** Title, subtitle and the table; only this prints while body.rpt-printing is set (see index.css). */
function PrintSheet({ data }: { data: SheetTable }) {
  const tc = data.text_cols;
  return (
    <div className="rpt-print">
      <h1>{data.title}</h1>
      <p>{data.subtitle}</p>
      <table>
        <thead>
          <tr>{data.header.map((h, i) => <th key={i} className={i < tc ? "txt" : undefined}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {data.rows.map((r, ri) => (
            <tr key={ri} className={cn(tc === 2 && ri > 0 && groupStarts(data, ri) && "grp")}>
              {r.map((v, i) => (
                <td key={i} className={i < tc ? "txt" : undefined}>
                  {i === 0 && tc === 2 && !groupStarts(data, ri) ? "" : cellOut(v, i >= tc) ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>{data.total.map((v, i) => <td key={i} className={i < tc ? "txt" : undefined}>{i < tc ? v : cellOut(v, true)}</td>)}</tr>
        </tfoot>
      </table>
    </div>
  );
}
