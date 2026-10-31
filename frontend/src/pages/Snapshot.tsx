import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Download, FileJson, FileSpreadsheet, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { api, backendUrl, type SnapshotDetail } from "@/lib/api";
import { periodLabel } from "@/lib/utils";
import { labelOf } from "@/lib/status";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, StatusBadge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Callout, ErrorState, LoadingRows, PageHeader, PlatformIcon } from "@/components/common";

export default function SnapshotPage() {
  const { id } = useParams();
  const { data: s, isLoading, error } = useQuery({ queryKey: ["snapshot", id], queryFn: () => api.get<SnapshotDetail>(`/api/reports/${id}`) });
  if (error) return <ErrorState error={error} />;
  if (isLoading || !s) return <LoadingRows rows={6} />;
  const d = s.data;

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">Report snapshot #{s.id} <StatusBadge status={s.kind} />{s.is_sample && <Badge tone="warning">Sample data</Badge>}</span>}
        description={<><span className="font-medium text-foreground">{d.presentation.summary_title}</span><br />
          {periodLabel(s.period_start, s.period_end)} (IST) · created by {s.created_by} on {s.created_at} · {d.campaign.rules_version != null ? `rules v${d.campaign.rules_version}` : "no search term"}{s.note && <> · “{s.note}”</>}</>}
        actions={<>
          <Button asChild><a href={backendUrl(`/reports/${s.id}/pdf`)}><Download /> Download PDF</a></Button>
          <Button variant="outline" asChild><a href={backendUrl(`/reports/${s.id}/evidence.csv`)}><FileSpreadsheet /> Evidence CSV</a></Button>
          <Button variant="outline" asChild><a href={backendUrl(`/reports/${s.id}/matrix.csv`)}><FileSpreadsheet /> Values CSV</a></Button>
          <Button variant="ghost" asChild><a href={backendUrl(`/reports/${s.id}/snapshot.json`)} target="_blank" rel="noopener"><FileJson /> JSON</a></Button>
        </>}
      />

      {s.superseded_by_id && (
        <Callout tone="warning" className="mb-6" title="This report has been superseded">
          A newer final was approved for the same period: <Link className="font-medium text-primary underline" to={`/reports/${s.superseded_by_id}`}>#{s.superseded_by_id}</Link>.
        </Callout>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card className="flex items-center gap-4 p-5">
          <div className={`flex size-11 items-center justify-center rounded-full ${s.intact ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
            {s.intact ? <ShieldCheck className="size-5" /> : <ShieldAlert className="size-5" />}
          </div>
          <div className="min-w-0">
            <div className="font-medium">{s.intact ? "Data integrity verified" : "Data has been MODIFIED"}</div>
            <div className="truncate font-mono text-xs text-muted-foreground">sha256 {s.data_sha256.slice(0, 24)}…</div>
          </div>
        </Card>
        <Card className="flex items-center gap-4 p-5">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground"><Download className="size-5" /></div>
          <div className="min-w-0">
            <div className="font-medium">PDF fingerprint</div>
            <div className="truncate font-mono text-xs text-muted-foreground">{s.pdf_sha256 ? `sha256 ${s.pdf_sha256.slice(0, 24)}…` : "Rendered on first download"}</div>
          </div>
        </Card>
      </div>

      <Card className="mb-6 overflow-hidden">
        <CardHeader><CardTitle>Division totals</CardTitle></CardHeader>
        <div className="overflow-x-auto border-t">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Division</th>
                {d.columns.map((c) => <th key={c.key} className="px-2 py-2 text-center font-medium" title={c.label_en}>{c.label_mr}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {d.divisions.map((div) => (
                <tr key={div.code}>
                  <td className="px-4 py-2 font-medium">{div.summary_label_mr}</td>
                  {d.columns.map((c) => {
                    const a = div.subtotal[c.key];
                    return <td key={c.key} className="px-2 py-2 text-center tabular">{a.known ? a.value : "–"}{!a.complete && <span className="text-warning">*</span>}</td>;
                  })}
                </tr>
              ))}
              <tr className="bg-muted/60 font-semibold">
                <td className="px-4 py-2">एकूण · Total</td>
                {d.columns.map((c) => {
                  const a = d.grand_total[c.key];
                  return <td key={c.key} className="px-2 py-2 text-center tabular">{a.known ? a.value : "–"}{!a.complete && "*"}</td>;
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Issues at approval time</CardTitle>
            <CardDescription>{d.issues.length ? `${d.issues.length} recorded` : "None — the report was complete."}</CardDescription>
          </CardHeader>
          {d.issues.length > 0 && (
            <CardContent>
              <ul className="max-h-96 space-y-2 overflow-y-auto text-sm">
                {d.issues.map((i, n) => (
                  <li key={n} className="flex gap-2">
                    <StatusBadge status={i.severity} />
                    <span><b>{labelOf(i.code)}</b> {i.office_name && `· ${i.office_name}`} — <span className="text-muted-foreground">{i.message}</span></span>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
        <Card>
          <CardHeader><CardTitle>Accounts & coverage</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {d.accounts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  <PlatformIcon platform={a.platform} className="size-5 text-[10px]" />
                  <span className="flex-1 truncate font-medium">{a.handle}</span>
                  {!a.mapping_confirmed && <Badge tone="warning">unconfirmed</Badge>}
                  {a.period_covered
                    ? <span className="flex items-center gap-1 text-xs text-success"><CheckCircle2 className="size-3.5" /> covered</span>
                    : <span className="flex items-center gap-1 text-xs text-danger"><XCircle className="size-3.5" /> not covered</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
