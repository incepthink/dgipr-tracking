import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronDown, ClipboardPen, Download, Eye } from "lucide-react";
import { api, type Cell, type Issue, type ReportResponse } from "@/lib/api";
import { usePeriod } from "@/lib/hooks";
import { cn, qs } from "@/lib/utils";
import { labelOf } from "@/lib/status";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Tip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Callout, ErrorState, LoadingRows, PageHeader, PeriodPicker } from "@/components/common";

function cellTip(cell: Cell) {
  const parts: string[] = [];
  if (cell.state === "entered") parts.push(cell.complete ? "Submitted by the office" : `Submitted for ${cell.days_entered ?? 0} day(s) only`);
  if (cell.manual) parts.push(`Entered by ${cell.manual.by}${cell.manual.note ? ` — ${cell.manual.note}` : ""}`);
  if (cell.state === "missing") parts.push("Not entered — never treated as zero");
  if (cell.collected) parts.push(`Collected cross-check: ${cell.collected.value}${cell.collected.issues.length ? ` (${cell.collected.issues.map(labelOf).join(", ")})` : ""}`);
  return parts.join(" · ");
}

function IssueList({ issues }: { issues: Issue[] }) {
  const groups = React.useMemo(() => {
    const g: Record<string, Issue[]> = {};
    issues.forEach((i) => (g[i.code] ??= []).push(i));
    return Object.entries(g).sort(([, a], [, b]) => (a[0].severity === "blocker" ? -1 : 1) - (b[0].severity === "blocker" ? -1 : 1));
  }, [issues]);
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <div className="divide-y rounded-lg border">
      {groups.map(([code, list]) => (
        <div key={code}>
          <button onClick={() => setOpen(open === code ? null : code)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent/50 cursor-pointer">
            {list[0].severity === "blocker" ? <AlertTriangle className="size-4 text-danger" /> : <AlertTriangle className="size-4 text-warning" />}
            <span className="flex-1 font-medium">{labelOf(code)}</span>
            <Badge tone={list[0].severity === "blocker" ? "danger" : "warning"}>{list.length}</Badge>
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open === code && "rotate-180")} />
          </button>
          {open === code && (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto bg-muted/30 px-3 py-2.5 text-xs">
              {list.map((i, n) => (
                <li key={n} className="flex gap-2">
                  {(i.office_name || i.office) && <span className="shrink-0 font-medium">{i.office_name || i.office}{i.column ? ` · ${i.column}` : ""}:</span>}
                  <span className="text-muted-foreground">{i.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ReportPage() {
  const period = usePeriod();
  // Like Review: the search term comes only from the URL (carried over from the previous step), no active-campaign fallback.
  // It is optional — without one the report counts every countable publication.
  const campaignId = Number(period.params.get("campaign_id")) || 0;
  const cid = campaignId || null;
  const { data, isLoading, error } = useQuery({
    queryKey: ["report", campaignId, period.start, period.end],
    enabled: period.ready,
    queryFn: () => api.get<ReportResponse>(`/api/report${qs({ campaign_id: cid, start: period.start, end: period.end })}`),
  });

  const blockers = data?.data.issues.filter((i) => i.severity === "blocker") ?? [];
  const warnings = data?.data.issues.filter((i) => i.severity === "warning") ?? [];
  const previewUrl = `/report/preview.pdf${qs({ campaign_id: cid, start: period.start, end: period.end })}`;
  const downloadUrl = `/report/preview.pdf${qs({ campaign_id: cid, start: period.start, end: period.end, download: 1 })}`;
  const reviewBase = { campaign_id: cid, start: period.start, end: period.end };

  return (
    <>
      <PageHeader step={3} title="Check & download report"
        description={data ? <span className="font-medium text-foreground">{data.data.presentation.summary_title}</span> : "Check completeness and download the PDF."}
        actions={<Button variant="outline" asChild><a href={previewUrl} target="_blank" rel="noopener"><Eye /> Preview draft PDF</a></Button>} />

      <div className="space-y-6 pb-24">
        <PeriodPicker campaignId={campaignId} start={period.start} end={period.end} searchableCampaign lockPeriod
          onChange={(p) => period.set(p)} />

        <Callout tone="info" icon={ClipboardPen} title="Figures come from the offices' report forms">
          Offices submit their daily figures in the campaign's <Link className="font-medium text-primary underline-offset-2 hover:underline"
            to="/forms">report form</Link>; the report sums the submitted days over the period. Collected
          social-media counts are shown beside each value as a cross-check. Periods without office entries use the earlier collected counts and manual values.
        </Callout>

        {error ? <ErrorState error={error} /> : isLoading || !data ? <Card><LoadingRows rows={8} /></Card> : (
          <>
            <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start">
              <Card className={cn(data.data.complete ? "border-success/30" : "border-danger/30")}>
                <CardHeader className="flex-row items-start gap-4">
                  <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", data.data.complete ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
                    {data.data.complete ? <CheckCircle2 className="size-6" /> : <AlertTriangle className="size-5" />}
                  </div>
                  <div>
                    <CardTitle>{data.data.complete ? "Report complete" : `${blockers.length} issue${blockers.length === 1 ? "" : "s"} to resolve`}</CardTitle>
                    <CardDescription>
                      {data.data.complete
                        ? "Every cell has a value and all collections, reviews and mappings are complete."
                        : "Fix these for a clean PDF. You can still download a draft at any time."}
                      {warnings.length > 0 && ` ${warnings.length} warning${warnings.length === 1 ? "" : "s"} (non-blocking).`}
                    </CardDescription>
                  </div>
                </CardHeader>
                {data.data.issues.length > 0 && <CardContent><IssueList issues={data.data.issues} /></CardContent>}
              </Card>

              <div>
                <Button className="h-16 w-full text-base" variant={data.data.complete ? "success" : "default"} asChild>
                  <a href={downloadUrl} download><Download className="size-5" /> Download PDF</a>
                </Button>
                {!data.data.complete && (
                  <span className="mt-2 block text-center text-xs text-muted-foreground">Incomplete — the PDF will be watermarked “प्रारूप · DRAFT”.</span>
                )}
              </div>
            </div>

            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>District values</CardTitle>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm border bg-card" /> Submitted / entered</span>
                  <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm border border-success/30 bg-success-soft" /> Counted automatically (click to review)</span>
                  <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm border border-danger/30 bg-danger-soft" /> Empty — never treated as zero</span>
                  <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm ring-2 ring-warning" /> Incomplete</span>
                  <span className="flex items-center gap-1.5"><span className="rounded border px-1 text-[10px]">↻ n</span> collected cross-check (amber when it differs)</span>
                </div>
              </CardHeader>
              <div className="max-h-[70vh] overflow-auto border-t scrollbar-thin">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead className="sticky top-0 z-20">
                    <tr>
                      <th className="sticky left-0 z-30 min-w-44 border-r border-b bg-muted px-3 py-2 text-left text-xs font-medium">Office</th>
                      {data.data.columns.map((c) => (
                        <th key={c.key} className="min-w-[84px] border-b bg-muted px-2 py-2 text-center align-bottom text-xs font-medium">
                          <div className="leading-tight">{c.label_mr}</div>
                          <div className="mt-0.5 text-[10px] font-normal text-muted-foreground">{c.label_en}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.divisions.map((div) => (
                      <React.Fragment key={div.code}>
                        <tr>
                          <td colSpan={data.data.columns.length + 1} className="sticky left-0 border-b bg-accent/60 px-3 py-1.5 text-xs font-semibold text-accent-foreground">
                            {div.section_title_mr}
                          </td>
                        </tr>
                        {div.offices.map((off) => (
                          <tr key={off.code} className="group">
                            <td className="sticky left-0 z-10 border-r border-b bg-card px-3 py-1.5 font-medium group-hover:bg-accent/40">
                              <div className="leading-tight">{off.name_mr}</div>
                              {off.name_en && <div className="text-[11px] font-normal text-muted-foreground">{off.name_en}</div>}
                            </td>
                            {data.data.columns.map((col) => {
                              const cell = off.cells[col.key];
                              if (cell.state === "auto") {
                                return (
                                  <td key={col.key} className="border-b p-1 group-hover:bg-accent/20">
                                    <Tip content={cell.issues.length ? cell.issues.map(labelOf).join(", ") : `${cell.value} publication(s) — click to review`}>
                                      <Link to={`/review${qs({ ...reviewBase, office: off.code })}`}
                                        className={cn("flex h-8 items-center justify-center rounded-md border border-success/25 bg-success-soft/70 font-semibold text-success tabular hover:bg-success-soft",
                                          !cell.complete && "ring-2 ring-warning ring-inset")}>
                                        {cell.value}
                                      </Link>
                                    </Tip>
                                  </td>
                                );
                              }
                              const c = cell.collected;
                              const differs = !!c && c.complete && cell.value !== null && c.value !== cell.value;
                              return (
                                <td key={col.key} className="border-b p-1 text-center group-hover:bg-accent/20">
                                  <Tip content={cellTip(cell)}>
                                    <div className={cn("flex h-8 items-center justify-center rounded-md border font-medium tabular",
                                      cell.state === "missing" ? "border-danger/30 bg-danger-soft/60 text-muted-foreground" : "bg-card",
                                      !cell.complete && cell.state !== "missing" && "ring-2 ring-warning ring-inset",
                                      cell.state === "confirmed_zero" && "text-muted-foreground")}>
                                      {cell.value ?? "–"}
                                    </div>
                                  </Tip>
                                  {c && (
                                    <Link to={`/review${qs({ ...reviewBase, office: off.code })}`}
                                      className={cn("mt-0.5 inline-block rounded border px-1 text-[10px] tabular hover:bg-accent",
                                        differs ? "border-warning/40 bg-warning-soft text-warning" : "text-muted-foreground")}>↻ {c.value}{!c.complete && "*"}</Link>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                        <tr>
                          <td className="sticky left-0 z-10 border-r border-b bg-muted px-3 py-1.5 text-xs font-semibold">एकूण · Subtotal</td>
                          {data.data.columns.map((c) => {
                            const a = div.subtotal[c.key];
                            return <td key={c.key} className="border-b bg-muted px-2 py-1.5 text-center text-xs font-semibold tabular">{a.known ? a.value : "–"}{!a.complete && <span className="text-warning">*</span>}</td>;
                          })}
                        </tr>
                      </React.Fragment>
                    ))}
                    <tr>
                      <td className="sticky left-0 z-10 border-r bg-foreground px-3 py-2 text-xs font-semibold text-background">एकूण (सर्व) · Grand total</td>
                      {data.data.columns.map((c) => {
                        const a = data.data.grand_total[c.key];
                        return <td key={c.key} className="bg-foreground px-2 py-2 text-center font-semibold text-background tabular">{a.known ? a.value : "–"}{!a.complete && "*"}</td>;
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="border-t px-5 py-2.5 text-xs text-muted-foreground">* subtotal includes incomplete or missing cells</div>
            </Card>
          </>
        )}
      </div>

    </>
  );
}
