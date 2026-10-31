import * as React from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical, RefreshCcw, Save, ScanText } from "lucide-react";
import { api, type CampaignFull, type TestResult } from "@/lib/api";
import { useAction, useMeta } from "@/lib/hooks";
import { cn, dmyText } from "@/lib/utils";
import { DateInput } from "@/components/reports/DateInput";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Callout, ErrorState, LoadingRows, PageHeader } from "@/components/common";

function Editor({ c }: { c: CampaignFull }) {
  const navigate = useNavigate();
  const { data: meta } = useMeta();
  const [form, setForm] = React.useState({ title_mr: c.title_mr, title_en: c.title_en, rules_yaml: c.rules_yaml, count_yaml: c.count_yaml });
  React.useEffect(() => setForm({ title_mr: c.title_mr, title_en: c.title_en, rules_yaml: c.rules_yaml, count_yaml: c.count_yaml }), [c]);
  const dirty = form.title_mr !== c.title_mr || form.title_en !== c.title_en || form.rules_yaml !== c.rules_yaml || form.count_yaml !== c.count_yaml;

  const save = useAction((body: typeof form) => api.put<CampaignFull>(`/api/campaigns/${c.id}`, body), {
    success: (r) => `Saved as rules v${r.version}`, invalidate: [["campaign", String(c.id)], ["meta"]],
  });

  const [text, setText] = React.useState("");
  const test = useAction((t: string) => api.post<TestResult>(`/api/campaigns/${c.id}/test`, { text: t }));

  const [range, setRange] = React.useState({ start: meta?.default_day ?? "", end: meta?.default_day ?? "" });
  React.useEffect(() => { if (meta && !range.start) setRange({ start: meta.default_day, end: meta.default_day }); }, [meta, range.start]);
  const reclass = useAction((r: typeof range) => api.post<{ count: number }>(`/api/campaigns/${c.id}/reclassify`, r), {
    success: (r) => `${r.count} publication(s) re-classified`, invalidate: [["review"], ["report"]],
  });

  return (
    <>
      <PageHeader title="Campaign rules"
        description={<>How publications are matched to <b className="text-foreground">{c.title_mr}</b>. Rules v{c.version} · updated {dmyText(c.updated_at)} by {c.updated_by}</>}
        actions={meta && meta.campaigns.length > 1 && (
          <Select value={c.id} onChange={(e) => navigate(`/campaigns/${e.target.value}`)} className="w-64">
            {meta.campaigns.map((x) => <option key={x.id} value={x.id}>{x.title_mr}</option>)}
          </Select>
        )} />

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader>
            <CardTitle>Definition</CardTitle>
            <CardDescription>Saving creates a new rules version; existing decisions don't change until you re-classify.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Marathi title (PDF heading)"><Input value={form.title_mr} onChange={(e) => setForm({ ...form, title_mr: e.target.value })} /></Field>
              <Field label="English title"><Input value={form.title_en} onChange={(e) => setForm({ ...form, title_en: e.target.value })} /></Field>
            </div>
            <Tabs defaultValue="rules">
              <TabsList>
                <TabsTrigger value="rules">Matching rules</TabsTrigger>
                <TabsTrigger value="count">Count rules</TabsTrigger>
              </TabsList>
              <TabsContent value="rules" className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Keywords, phrases and exclusions per language (mr, hi, en); hashtags; weights; <code>match_threshold</code>, <code>review_threshold</code>, <code>min_text_chars</code>.
                  Devanagari keywords also match inflected forms (दुष्काळ → दुष्काळी). Latin terms match whole words unless they end in <code>*</code>.
                </p>
                <Textarea spellCheck={false} rows={22} value={form.rules_yaml} onChange={(e) => setForm({ ...form, rules_yaml: e.target.value })} className="font-mono text-[13px] leading-relaxed" />
              </TabsContent>
              <TabsContent value="count" className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Which publication types count toward report columns. <code>video_bites_source</code> / <code>video_interviews_source</code>: <code>manual</code> (default) or <code>reviewer_tag</code> — a video is never counted as a bite/interview without an explicit reviewer tag.
                </p>
                <Textarea spellCheck={false} rows={14} value={form.count_yaml} onChange={(e) => setForm({ ...form, count_yaml: e.target.value })} className="font-mono text-[13px] leading-relaxed" />
              </TabsContent>
            </Tabs>
            <div className="flex items-center justify-end gap-2">
              {dirty && <Button variant="ghost" onClick={() => setForm({ title_mr: c.title_mr, title_en: c.title_en, rules_yaml: c.rules_yaml, count_yaml: c.count_yaml })}>Discard</Button>}
              <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(form)}><Save /> Save as v{c.version + 1}</Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FlaskConical className="size-4" /> Test the rules</CardTitle>
              <CardDescription>Paste a caption to see how the saved rules classify it.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a caption or post text…" />
              <Button variant="secondary" className="w-full" disabled={!text.trim()} loading={test.isPending} onClick={() => test.mutate(text)}><ScanText /> Classify</Button>
              {test.data && (
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <StatusBadge status={test.data.decision} />
                    <span className="text-sm text-muted-foreground tabular">score {test.data.score}</span>
                  </div>
                  {test.data.reasons.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">{test.data.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
                  {test.data.evidence.length > 0 && (
                    <div className="space-y-1.5">
                      {test.data.evidence.map((e, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <Badge tone={e.kind === "exclusion" ? "danger" : "info"}>{e.kind}</Badge>
                          <span className={cn("font-medium")}>{e.term}</span>
                          <span className="text-muted-foreground">{e.lang}</span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={e.snippet}>…{e.snippet}…</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><RefreshCcw className="size-4" /> Re-classify a period</CardTitle>
              <CardDescription>Recompute automatic decisions with the current rules. Manual decisions are kept.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="From"><DateInput look="plain" value={range.start} onChange={(d) => setRange({ ...range, start: d })} /></Field>
                <Field label="To"><DateInput look="plain" value={range.end} onChange={(d) => setRange({ ...range, end: d })} /></Field>
              </div>
              <Button variant="outline" className="w-full" disabled={!range.start || !range.end || dirty} loading={reclass.isPending} onClick={() => reclass.mutate(range)}>Re-classify</Button>
              {dirty && <p className="text-xs text-warning">Save your rule changes first.</p>}
            </CardContent>
          </Card>

          <Callout tone="info">
            Only text is classified. Images, video and audio are <b>not</b> analysed (no OCR, transcription or AI). Posts whose relevance can't be judged from text are flagged <b>Too little text</b> for review.
          </Callout>
        </div>
      </div>
    </>
  );
}

export default function CampaignPage() {
  const { id } = useParams();
  const { data: meta } = useMeta();
  const { data, isLoading, error } = useQuery({ queryKey: ["campaign", id], enabled: !!id, queryFn: () => api.get<CampaignFull>(`/api/campaigns/${id}`) });
  if (!id) {
    if (!meta) return <LoadingRows />;
    const first = meta.campaigns.find((c) => c.active) ?? meta.campaigns[0];
    return first ? <Navigate to={`/campaigns/${first.id}`} replace /> : <Callout title="No campaigns configured" />;
  }
  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <LoadingRows rows={8} />;
  return <Editor c={data} />;
}
