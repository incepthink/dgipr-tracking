import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { api, type Publication } from "@/lib/api";
import { PLATFORM_LABEL } from "@/lib/status";
import { dmyText } from "@/lib/utils";
import { Badge, Card, CardContent, CardHeader, CardTitle, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { ErrorState, JsonBlock, LoadingRows, PageHeader, PlatformIcon } from "@/components/common";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export default function PublicationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: p, isLoading, error } = useQuery({ queryKey: ["publication", id], queryFn: () => api.get<Publication>(`/api/publications/${id}`) });
  if (error) return <ErrorState error={error} />;
  if (isLoading || !p) return <LoadingRows rows={6} />;

  return (
    <>
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" onClick={() => navigate(-1)}><ArrowLeft /> Back</Button>
      <PageHeader
        title={<span className="flex items-center gap-3"><PlatformIcon platform={p.platform} className="size-8 text-xs" /> Publication #{p.id}</span>}
        description={<>{PLATFORM_LABEL[p.platform]} · {p.account.handle} · {dmyText(p.published_at)}</>}
        actions={<Button variant="outline" asChild><a href={p.url} target="_blank" rel="noopener">Open original <ExternalLink /></a></Button>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_440px]">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Content</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {p.title && <p className="font-semibold">{p.title}</p>}
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{p.text || <span className="text-muted-foreground italic">No text</span>}</p>
              {p.description && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{p.description}</p>}
              <div>
                <div className="mt-4 mb-1.5 text-xs font-medium text-muted-foreground">Media references (not downloaded or analysed)</div>
                {p.media.length ? (
                  <ul className="space-y-1 text-xs">
                    {p.media.map((m, i) => <li key={i} className="truncate"><Badge className="mr-2">{m.kind}</Badge><a className="text-primary hover:underline" href={m.url} target="_blank" rel="noopener">{m.url}</a></li>)}
                  </ul>
                ) : <span className="text-xs text-muted-foreground">None</span>}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="divide-y">
              <Row label="Account">{p.account.handle} → {p.office ? `${p.office.name_mr} (${p.office.name_en})` : <span className="text-warning">unmapped</span>}</Row>
              <Row label="Published">{dmyText(p.published_at)} · <span className="text-muted-foreground">{dmyText(p.published_at_utc)} UTC</span></Row>
              <Row label="Reporting date">{dmyText(p.reporting_date)} (IST)</Row>
              <Row label="Type">
                <div className="flex flex-wrap gap-1">
                  <Badge>{p.content_type}</Badge>
                  {(["is_repost", "is_reply", "is_quote", "is_pinned", "is_short"] as const).filter((f) => p[f]).map((f) => <Badge key={f}>{f.slice(3)}</Badge>)}
                </div>
              </Row>
              <Row label="Metrics">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {Object.entries(p.metrics).map(([k, v]) => <span key={k}><span className="text-muted-foreground">{k}</span> <b className="tabular">{v ?? "n/a"}</b></span>)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">observed {dmyText(p.metrics_observed_at)} · n/a means not supplied by the provider (not zero)</div>
              </Row>
              <Row label="Collected">first {dmyText(p.first_collected_at)} (run {p.first_run_id}) · last {dmyText(p.last_collected_at)} (run {p.last_run_id})</Row>
              <Row label="Provider">{p.provider} · post ID <span className="font-mono text-xs">{p.platform_post_id}</span></Row>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Classification</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {p.classifications.map((c) => (
                <div key={c.id} className="space-y-2 rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">Campaign {c.campaign_id}</span>
                    <span className="text-muted-foreground">· auto</span><StatusBadge status={c.auto_decision} />
                    <span className="text-muted-foreground">→ now</span><StatusBadge status={c.effective_decision} />
                  </div>
                  <div className="text-xs text-muted-foreground">{c.classifier} {c.classifier_version} · rules v{c.rules_version} · score {c.auto_score}</div>
                  {c.manual_decision && <div className="text-xs">Manual: <b>{c.manual_decision}</b> by {c.manual_by} {c.manual_note && <>— “{c.manual_note}”</>}</div>}
                </div>
              ))}
              {p.history.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Review history</div>
                  <ol className="relative space-y-3 border-l pl-4">
                    {p.history.map((h) => (
                      <li key={h.id} className="text-xs">
                        <span className="absolute -left-[5px] mt-1 size-2.5 rounded-full border-2 border-card bg-primary" />
                        <div className="font-medium">{h.action} · {h.actor}</div>
                        <div className="text-muted-foreground">{dmyText(h.at)}{h.note && ` — ${h.note}`}</div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <Link to={`/monitor?start=${p.reporting_date}&end=${p.reporting_date}&step=review`} className="inline-block text-sm font-medium text-primary hover:underline">Review this day →</Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Technical data</CardTitle></CardHeader>
            <CardContent>
              <Tabs defaultValue="evidence">
                <TabsList>
                  <TabsTrigger value="evidence">Evidence</TabsTrigger>
                  <TabsTrigger value="raw">Raw record</TabsTrigger>
                  <TabsTrigger value="prov">Provenance</TabsTrigger>
                  <TabsTrigger value="attr">Attributes</TabsTrigger>
                </TabsList>
                <TabsContent value="evidence" className="mt-3"><JsonBlock value={p.classifications.map((c) => c.auto_evidence)} /></TabsContent>
                <TabsContent value="raw" className="mt-3">
                  {p.raw ? <>
                    <div className="mb-2 text-xs text-muted-foreground">{p.raw.provider} · fetched {dmyText(p.raw.fetched_at)} · sha256 {p.raw.sha256.slice(0, 16)}…</div>
                    <JsonBlock value={p.raw.payload} />
                  </> : <span className="text-sm text-muted-foreground">No raw record.</span>}
                </TabsContent>
                <TabsContent value="prov" className="mt-3"><JsonBlock value={p.provenance} /></TabsContent>
                <TabsContent value="attr" className="mt-3"><JsonBlock value={p.attributes} /></TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
