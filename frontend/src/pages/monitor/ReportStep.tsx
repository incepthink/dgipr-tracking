import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, Eye, FileDown, RotateCw } from "lucide-react";
import { api, type Cell, type Issue, type ReportData, type ReportResponse } from "@/lib/api";
import { cn, qs } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { labelOf } from "@/lib/status";
import { RButton, RError } from "@/components/reports/kit";
import { ActiveCard, dayLabel, Eyebrow, PendingCard, rangeLabel, StepFrame } from "./shared";

export function pdfUrls(campaignId: number, start: string, end: string) {
  const base = { campaign_id: campaignId || null, start, end };
  return { preview: `/report/preview.pdf${qs(base)}`, download: `/report/preview.pdf${qs({ ...base, download: 1 })}` };
}

export function ReportTeaser({ waitingOnReview, start, end, previewUrl }: { waitingOnReview: boolean; start: string; end: string; previewUrl?: string }) {
  const { t, tf, lang } = useT();
  return (
    <StepFrame n={3} state="todo" last labelledBy="s3">
      <PendingCard id="s3" eyebrow={waitingOnReview ? t("step3_opens") : t("step3_after")} title={t("report_title")}
        aside={previewUrl ? (
          <a href={previewUrl} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-r-action no-underline hover:text-r-action-hover">
            <Eye className="size-4" aria-hidden />{t("peek_draft")}
          </a>
        ) : <FileDown className="size-7 text-r-faint" strokeWidth={1.6} aria-hidden />}>
        {!waitingOnReview && <p className="m-0 mt-1.5 text-sm text-r-muted">{tf("report_teaser", { day: start === end ? dayLabel(start, lang) : rangeLabel(start, end, lang) })}</p>}
      </PendingCard>
    </StepFrame>
  );
}

type Fix = { key: string; blocker: boolean; title: string; body: React.ReactNode; action?: React.ReactNode };

function useFixes(data: ReportData, opts: { onRetry?: () => void; retrying: boolean; onBackToReview: () => void }) {
  const { t, tf } = useT();
  const by = (codes: string[]) => data.issues.filter((i) => codes.includes(i.code));
  const offices = (list: Issue[]) => [...new Set(list.map((i) => i.office_name || i.office).filter(Boolean))];
  const out: Fix[] = [];
  const used = new Set<string>();

  const collect = by(["collection_incomplete", "task_failed"]);
  if (collect.length) {
    const unc = data.accounts.filter((a) => !a.period_covered);
    out.push({
      key: "collect", blocker: collect.some((i) => i.severity === "blocker"),
      title: tf("fx_collect_t", { n: unc.length || offices(collect).length || collect.length }),
      body: <>{unc.length > 0 && <span className="block">{unc.slice(0, 5).map((a) => a.handle).join(" · ")}{unc.length > 5 ? " …" : ""}</span>}{t("fx_collect_b")}</>,
      action: opts.onRetry && <RButton size="sm" loading={opts.retrying} onClick={opts.onRetry}><RotateCw aria-hidden />{t("retry_now")}</RButton>,
    });
  }
  const mapping = by(["mapping_unconfirmed", "account_unmapped"]);
  if (mapping.length) {
    const unc = data.accounts.filter((a) => !a.mapping_confirmed || !a.office);
    out.push({
      key: "mapping", blocker: mapping.some((i) => i.severity === "blocker"),
      title: tf("fx_map_t", { n: unc.length || mapping.length }),
      body: unc.slice(0, 6).map((a) => a.handle).join(" · ") + (unc.length > 6 ? " …" : ""),
      action: <RButton size="sm" asChild><Link to="/accounts">{t("confirm_offices")}</Link></RButton>,
    });
  }
  const pending = by(["pending_review"]);
  if (pending.length) out.push({
    key: "pending", blocker: pending.some((i) => i.severity === "blocker"), title: tf("fx_pending_t", { n: pending.length }),
    body: offices(pending).slice(0, 6).join(" · "),
    action: <RButton size="sm" onClick={opts.onBackToReview}>{t("back_review")}</RButton>,
  });
  const missing = by(["missing_input", "missing_days"]);
  if (missing.length) out.push({
    key: "missing", blocker: missing.some((i) => i.severity === "blocker"), title: tf("fx_missing_t", { n: missing.length }),
    body: <><span className="block">{offices(missing).slice(0, 6).join(" · ")}{offices(missing).length > 6 ? " …" : ""}</span>{t("fx_missing_b")}</>,
    action: <RButton size="sm" asChild><Link to="/forms/responses">{t("open_responses")}</Link></RButton>,
  });
  const differs = by(["collected_differs"]);
  if (differs.length) out.push({
    key: "differs", blocker: false, title: tf("fx_differs_t", { n: differs.length }),
    body: differs.slice(0, 3).map((i) => `${i.office_name || i.office}${i.column ? ` · ${i.column}` : ""}: ${i.message}`).join(" · "),
    action: <RButton size="sm" variant="ghost" asChild><a href="#dv">{t("show_in_table")}</a></RButton>,
  });
  ["collection_incomplete", "task_failed", "mapping_unconfirmed", "account_unmapped", "pending_review", "missing_input", "missing_days", "collected_differs"].forEach((c) => used.add(c));
  const rest: Record<string, Issue[]> = {};
  data.issues.filter((i) => !used.has(i.code)).forEach((i) => (rest[i.code] ??= []).push(i));
  for (const [code, list] of Object.entries(rest)) out.push({
    key: code, blocker: list.some((i) => i.severity === "blocker"), title: `${labelOf(code)} · ${list.length}`, body: list[0].message,
  });
  return out.sort((a, b) => +b.blocker - +a.blocker);
}

export function ReportActive({ campaignId, start, end, onRetry, retrying, onBackToReview, onNewRun }: {
  campaignId: number; start: string; end: string; onRetry?: () => void; retrying: boolean; onBackToReview: () => void; onNewRun?: () => void;
}) {
  const { t, tf } = useT();
  const { data, error, isLoading } = useQuery({
    queryKey: ["report", campaignId, start, end],
    queryFn: () => api.get<ReportResponse>(`/api/report${qs({ campaign_id: campaignId || null, start, end })}`),
  });
  const urls = pdfUrls(campaignId, start, end);
  const complete = !!data?.data.complete;

  return (
    <StepFrame n={3} state="active" last labelledBy="s3">
      <ActiveCard>
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-[22px] sm:px-6">
          <div>
            <Eyebrow tone="focus">{tf("step_of", { n: 3 })}</Eyebrow>
            <h2 id="s3" className="disp m-0 mt-1 text-2xl font-bold">{t("report_title")}</h2>
            {data && <p className="m-0 mt-1 text-sm text-r-muted">{data.data.presentation.summary_title}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <RButton asChild><a href={urls.preview} target="_blank" rel="noopener"><Eye aria-hidden />{t("mon_preview")}</a></RButton>
            <RButton variant="pri" asChild className={cn(complete && "border-r-accepted bg-r-accepted hover:border-r-accepted hover:bg-r-accepted/90")}>
              <a href={urls.download} download><Download aria-hidden />{complete ? t("dl_final") : t("dl_draft")}</a>
            </RButton>
          </div>
        </div>

        <div className="flex flex-col gap-6 px-5 pt-5 pb-6 sm:px-6">
          {error ? <RError error={error} /> : isLoading || !data ? (
            <div aria-hidden className="flex flex-col gap-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-[10px] bg-r-line-soft" />)}</div>
          ) : (
            <>
              <FixList data={data.data} onRetry={onRetry} retrying={retrying} onBackToReview={onBackToReview} />
              <DistrictTable data={data.data} />
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-r-line-soft bg-r-ground/60 px-5 py-4 text-[13px] text-r-muted sm:px-6">
          {!complete && <span className="min-w-0 flex-[1_1_320px]">{t("fixes_note")} <b className="text-r-ink">{t("dl_final")}</b>.</span>}
          <span className="flex-1" />
          {onNewRun && <button type="button" onClick={onNewRun} className="cursor-pointer border-0 bg-transparent p-0 text-sm font-bold text-r-action hover:text-r-action-hover">{t("start_new_run")}</button>}
        </div>
      </ActiveCard>
    </StepFrame>
  );
}

function FixList({ data, ...opts }: { data: ReportData; onRetry?: () => void; retrying: boolean; onBackToReview: () => void }) {
  const { t } = useT();
  const fixes = useFixes(data, opts);
  if (!fixes.length) return (
    <div className="flex items-center gap-3 rounded-xl border-[1.5px] border-r-accepted bg-r-accepted-soft p-4">
      <CheckCircle2 className="size-6 shrink-0 text-r-accepted" aria-hidden /><b>{t("all_clear")}</b>
    </div>
  );
  let n = 0;
  return (
    <div>
      <div className="mb-2.5 text-sm font-bold">{t("to_fix")}</div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {fixes.map((f) => (
          <li key={f.key} className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl border px-4 py-3",
            f.blocker ? "border-r-overdue/35 bg-r-card" : "border-r-line-soft bg-r-ground/60")}>
            {f.blocker
              ? <span className="num flex size-7 shrink-0 items-center justify-center rounded-full bg-r-overdue-soft text-[13px] font-bold text-r-overdue-ink">{++n}</span>
              : <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-r-returned-soft text-r-returned"><AlertTriangle className="size-[15px]" aria-hidden /></span>}
            <div className="min-w-0 flex-[1_1_280px]">
              <div className="text-[15px] font-bold">{f.title}{!f.blocker && <span className="font-normal text-r-muted"> · {t("wont_block")}</span>}</div>
              {f.body && <div className="mt-0.5 text-sm text-r-muted">{f.body}</div>}
            </div>
            {f.action}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CellView({ cell }: { cell: Cell }) {
  const c = cell.collected;
  const differs = !!c && c.complete && cell.value !== null && c.value !== cell.value;
  return (
    <div className="flex items-center justify-center gap-1.5">
      <span className={cn("inline-flex h-8 min-w-10 items-center justify-center rounded-md px-1.5 font-semibold",
        cell.state === "auto" && "bg-r-accepted-soft text-r-accepted",
        cell.state === "missing" && "bg-r-overdue-soft text-r-muted",
        cell.state === "confirmed_zero" && "text-r-muted",
        !cell.complete && cell.state !== "missing" && "ring-2 ring-r-returned ring-inset")}>
        {cell.value ?? "–"}
      </span>
      {c && <span className={cn("rounded px-1 text-[11px]", differs ? "bg-r-returned-soft font-bold text-r-returned-ink" : "text-r-faint")}>↻ {c.value}{!c.complete && "*"}</span>}
    </div>
  );
}

function DistrictTable({ data }: { data: ReportData }) {
  const { t, tf, name } = useT();
  const [all, setAll] = React.useState(false);
  const divisions = all ? data.divisions : data.divisions.slice(0, 1);
  const cols = data.columns;
  return (
    <div id="dv" className="scroll-mt-20">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-bold">{t("district_values")}</div>
        <div className="flex flex-wrap gap-3.5 text-xs text-r-muted">
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-r-line bg-r-card" />{t("lg_form")}</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-r-accepted-soft ring-1 ring-r-accepted/40" />{t("lg_counted")}</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-r-overdue-soft ring-1 ring-r-overdue/30" />{t("lg_empty")}</span>
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-xl border border-r-line-soft">
        <table className="num w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20">
            <tr>
              <th scope="col" className="sticky left-0 z-30 min-w-40 border-b border-r-line bg-r-sunk px-3 py-2 text-left font-body text-xs font-bold">{t("mon_office")}</th>
              {cols.map((c) => (
                <th key={c.key} scope="col" className="min-w-[88px] border-b border-r-line bg-r-sunk px-2 py-2 text-center align-bottom font-body text-xs font-bold">
                  <div className="leading-tight">{c.label_mr}</div><div className="mt-0.5 text-[11px] font-normal text-r-muted">{c.label_en}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {divisions.map((div) => (
              <React.Fragment key={div.code}>
                <tr><td colSpan={cols.length + 1} className="sticky left-0 border-b border-r-line-soft bg-r-ground px-3 py-1.5 font-body text-xs font-bold text-r-muted">{div.section_title_mr}</td></tr>
                {div.offices.map((off) => (
                  <tr key={off.code}>
                    <th scope="row" className="sticky left-0 z-10 border-b border-r-line-soft bg-r-card px-3 py-1.5 text-left font-body font-bold">{name(off)}</th>
                    {cols.map((c) => <td key={c.key} className="border-b border-r-line-soft p-1 text-center"><CellView cell={off.cells[c.key]} /></td>)}
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="sticky left-0 z-10 border-b border-r-line bg-r-sunk px-3 py-1.5 text-left font-body text-xs font-bold">एकूण · Subtotal</th>
                  {cols.map((c) => {
                    const a = div.subtotal[c.key];
                    return <td key={c.key} className="border-b border-r-line bg-r-sunk px-2 py-1.5 text-center text-xs font-bold">{a.known ? a.value : "–"}{!a.complete && <span className="text-r-returned">*</span>}</td>;
                  })}
                </tr>
              </React.Fragment>
            ))}
            {all && (
              <tr>
                <th scope="row" className="sticky left-0 z-10 bg-r-ink px-3 py-2 text-left font-body text-xs font-bold text-r-card">एकूण (सर्व) · Grand total</th>
                {cols.map((c) => {
                  const a = data.grand_total[c.key];
                  return <td key={c.key} className="bg-r-ink px-2 py-2 text-center font-bold text-r-card">{a.known ? a.value : "–"}{!a.complete && "*"}</td>;
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-r-muted">
        <span>{t("tbl_foot")}</span>
        {data.divisions.length > 1 && (
          <button type="button" onClick={() => setAll(!all)} className="cursor-pointer border-0 bg-transparent p-0 text-sm font-bold text-r-action hover:text-r-action-hover">
            {all ? t("show_fewer") : tf("show_all_div", { n: data.divisions.length })}
          </button>
        )}
      </div>
    </div>
  );
}
