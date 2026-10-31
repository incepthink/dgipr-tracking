import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, CheckCheck, ExternalLink, FileSearch, Image, Pin, RotateCcw, Tag, X } from "lucide-react";
import { api, type Cls, type ReviewData, type ReviewRow } from "@/lib/api";
import { useAction, useMeta, usePeriod } from "@/lib/hooks";
import { cn, dmyText, qs } from "@/lib/utils";
import { labelOf, PLATFORM_LABEL } from "@/lib/status";
import { Badge, Card, Field, Select, Textarea, Tip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingRows, OfficeSelect, PageHeader, PeriodPicker, PlatformIcon } from "@/components/common";

const QUICK = [
  { v: "", label: "All" },
  { v: "pending", label: "Awaiting decision" },
  { v: "include", label: "Included" },
  { v: "exclude", label: "Excluded" },
  { v: "needs_review", label: "Needs review" },
  { v: "insufficient_text", label: "Too little text" },
];

type Decide = { cls: Cls; action: "include" | "exclude" | "reset"; note?: string; report_tag?: string };

function needsNote(cls: Cls, action: string) {
  return (action === "include" && cls.auto_decision !== "match") || (action === "exclude" && cls.auto_decision !== "no_match");
}

function Highlighted({ parts }: { parts: [string, boolean][] }) {
  return <>{parts.map(([seg, hit], i) => hit ? <mark key={i} className="rounded-sm bg-mark px-0.5 text-foreground">{seg}</mark> : <React.Fragment key={i}>{seg}</React.Fragment>)}</>;
}

function PubText({ row }: { row: ReviewRow }) {
  const [open, setOpen] = React.useState(false);
  const fields = Object.entries(row.highlight);
  if (!fields.length) return <p className="text-sm text-muted-foreground italic">No text in this publication.</p>;
  const long = fields.reduce((n, [, parts]) => n + parts.reduce((m, [s]) => m + s.length, 0), 0) > 420;
  return (
    <div>
      <div className={cn("space-y-2 text-sm leading-relaxed whitespace-pre-wrap", !open && long && "max-h-36 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]")}>
        {fields.map(([f, parts]) => (
          <div key={f} className={cn(f === "title" && "font-semibold", f === "description" && "text-muted-foreground")}>
            {f !== "text" && <span className="mr-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{f}</span>}
            <Highlighted parts={parts} />
          </div>
        ))}
      </div>
      {long && <button className="mt-1 text-xs font-medium text-primary hover:underline cursor-pointer" onClick={() => setOpen(!open)}>{open ? "Show less" : "Show more"}</button>}
    </div>
  );
}

function ReviewCard({ row, onDecide, busy, hasTerm }: { row: ReviewRow; onDecide: (d: Decide) => void; busy: boolean; hasTerm: boolean }) {
  const { pub, cls } = row;
  const [tag, setTag] = React.useState("__keep__");
  const flags = [pub.is_pinned && "pinned", pub.is_repost && "repost", pub.is_reply && "reply", pub.is_quote && "quote", pub.is_short && "short"].filter(Boolean) as string[];

  return (
    <Card id={`p${pub.id}`} className={cn("overflow-hidden", !row.counts && "opacity-80")}>
      <div className="grid lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 p-5">
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <PlatformIcon platform={pub.platform} />
            <span className="text-sm font-semibold">{pub.account.handle}</span>
            <span className="text-sm text-muted-foreground">{pub.office ? pub.office.name_mr : <span className="text-warning">unmapped</span>}</span>
            <span className="text-xs text-muted-foreground">· {dmyText(pub.published_at)}</span>
            <div className="flex flex-wrap gap-1">
              <Badge>{pub.content_type}</Badge>
              {flags.map((f) => <Badge key={f}>{f === "pinned" && <Pin className="size-3" />}{f}</Badge>)}
              {pub.media_count > 0 && (
                <Tip content="Images and video are not analysed — only the text is classified.">
                  <Badge><Image className="size-3" />{pub.media_count}</Badge>
                </Tip>
              )}
            </div>
          </div>
          <PubText row={row} />
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs">
            <a href={pub.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              Open on {PLATFORM_LABEL[pub.platform] ?? pub.platform} <ExternalLink className="size-3" />
            </a>
            <Link to={`/publications/${pub.id}`} className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground">
              <FileSearch className="size-3.5" /> Details & raw data
            </Link>
            {!row.counts && <span className="text-muted-foreground">Not counted: {row.count_reason}</span>}
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t bg-muted/30 p-5 lg:border-t-0 lg:border-l">
          {!cls ? (
            <div className="text-sm text-muted-foreground">{hasTerm ? "Not classified yet for this search term." : "Pick a search term to include or exclude posts."}</div>
          ) : (
            <>
              <div>
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Decision</span>
                  {cls.manual_decision ? <span>by {cls.manual_by}</span> : <span>from suggestion</span>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant={row.eff === "include" ? "success" : "outline"} disabled={busy}
                    onClick={() => onDecide({ cls, action: "include", report_tag: tag })}>
                    <Check /> Include
                  </Button>
                  <Button size="sm" variant={row.eff === "exclude" ? "destructive" : "outline"} disabled={busy}
                    onClick={() => onDecide({ cls, action: "exclude", report_tag: tag })}>
                    <X /> Exclude
                  </Button>
                </div>
                {cls.manual_note && <p className="mt-2 text-xs text-muted-foreground italic">“{cls.manual_note}”</p>}
                <div className="mt-3 flex items-center gap-2">
                  <Tip content="Only used if the search term counts video bites/interviews by reviewer tag. Applied with the next Include/Exclude.">
                    <Tag className="size-3.5 shrink-0 text-muted-foreground" />
                  </Tip>
                  <Select value={tag} onChange={(e) => setTag(e.target.value)} className="flex-1 [&_select]:h-8 [&_select]:text-xs">
                    <option value="__keep__">Tag: {cls.report_tag ? labelOf(cls.report_tag) : "none"} (keep)</option>
                    <option value="">No tag</option>
                    <option value="video_bite">Video bite</option>
                    <option value="video_interview">Video interview</option>
                  </Select>
                  {cls.manual_decision && (
                    <Tip content="Reset to the automatic suggestion">
                      <Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => onDecide({ cls, action: "reset" })}><RotateCcw /></Button>
                    </Tip>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function ReviewPage() {
  const period = usePeriod();
  const { data: meta } = useMeta();
  // Search term is optional and starts empty — only an explicit pick in the URL counts, no active-campaign fallback.
  const campaignId = Number(period.params.get("campaign_id")) || 0;
  const platform = period.params.get("platform") ?? "";
  const decision = period.params.get("decision") ?? "";
  const office = period.params.get("office") ?? "";
  const key = ["review", campaignId, period.start, period.end, platform, decision, office];
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: key,
    enabled: period.ready,
    queryFn: () => api.get<ReviewData>(`/api/review${qs({ campaign_id: campaignId || null, start: period.start, end: period.end, platform, decision, office })}`),
    placeholderData: (prev) => prev,
  });

  const [pending, setPending] = React.useState<Decide | null>(null);
  const [note, setNote] = React.useState("");

  const decide = useAction(
    (d: Decide) => api.post<Cls>(`/api/review/${d.cls.id}`, { action: d.action, note: d.note ?? "", report_tag: d.report_tag ?? "__keep__" }),
    { invalidate: [["review"], ["report"], ["dashboard"]], onSuccess: () => { setPending(null); setNote(""); } },
  );
  const bulk = useAction(
    () => api.post<{ accepted: number }>("/api/review/bulk-accept", { campaign_id: campaignId, start: period.start, end: period.end }),
    { success: (r) => `${r.accepted} proposed match${r.accepted === 1 ? "" : "es"} accepted`, invalidate: [["review"], ["report"], ["dashboard"]] },
  );

  const onDecide = (d: Decide) => {
    if (d.action !== "reset" && needsNote(d.cls, d.action)) { setPending(d); setNote(""); return; }
    decide.mutate(d);
  };

  const proposed = data?.rows.filter((r) => r.cls && !r.cls.manual_decision && r.cls.auto_decision === "match").length ?? 0;
  const reportLink = `/report${qs({ campaign_id: campaignId || null, start: period.start, end: period.end })}`;

  return (
    <>
      <PageHeader step={2} title="Review publications"
        description="Check each post's evidence and confirm whether it matches the search term. Highlighted words are the keywords that matched."
        actions={<Button asChild><Link to={reportLink}>Continue to report <ArrowRight /></Link></Button>} />

      <div className="space-y-4">
        <PeriodPicker campaignId={campaignId} start={period.start} end={period.end} onChange={period.set} searchableCampaign lockPeriod
          extra={<>
            <Field label="Platform">
              <Select value={platform} onChange={(e) => period.set({ platform: e.target.value })} className="w-36">
                <option value="">All platforms</option>
                {meta?.platforms?.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p] ?? p}</option>)}
              </Select>
            </Field>
            <Field label="Office"><OfficeSelect value={office} onChange={(v) => period.set({ office: v })} placeholder="All offices" className="w-52" /></Field>
          </>} />

        {data && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="p-4"><div className="text-xs text-muted-foreground">Publications shown</div><div className="text-2xl font-semibold tabular">{data.summary.total}</div></Card>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {QUICK.map((q) => (
              <button key={q.v} onClick={() => period.set({ decision: q.v })}
                className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-all cursor-pointer",
                  decision === q.v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {q.label}
              </button>
            ))}
          </div>
          <Tip content="Marks every proposed match without a manual decision as reviewed and included (each one is audited).">
            <Button variant="outline" loading={bulk.isPending} disabled={!proposed} onClick={() => bulk.mutate(undefined)}>
              <CheckCheck /> Accept {proposed || ""} proposed match{proposed === 1 ? "" : "es"}
            </Button>
          </Tip>
        </div>

        {error ? <ErrorState error={error} /> : isLoading || !data ? <Card><LoadingRows rows={4} /></Card> : data.rows.length === 0 ? (
          <Card>
            <EmptyState icon={FileSearch} title="No publications for this period and filter"
              action={<Button size="sm" variant="outline" asChild><Link to={`/collect${qs({ campaign_id: campaignId || null, start: period.start, end: period.end })}`}>Run a collection</Link></Button>}>
              Try a different date or clear the filters.
            </EmptyState>
          </Card>
        ) : (
          <div className={cn("space-y-3 transition-opacity", isFetching && "opacity-70")}>
            {data.rows.map((r) => <ReviewCard key={r.pub.id} row={r} busy={decide.isPending} onDecide={onDecide} hasTerm={!!campaignId} />)}
          </div>
        )}
      </div>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.action === "include" ? "Include" : "Exclude"} — add a note</DialogTitle>
            <DialogDescription>
              The automatic suggestion was <b>{pending && labelOf(pending.cls.auto_decision)}</b>. A short note is required when overriding or settling an uncertain suggestion — it is kept in the audit log.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (pending && note.trim()) decide.mutate({ ...pending, note: note.trim() }); }}>
            <Textarea autoFocus rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={pending?.action === "include" ? "e.g. Post is about tanker water supply in drought villages" : "e.g. Unrelated — district sports event"} />
            <div className="flex flex-wrap gap-1.5">
              {(pending?.action === "include"
                ? ["Clearly about the search term", "Search term mentioned in image/video"]
                : ["Unrelated topic", "Only a passing mention", "Duplicate of another post"]).map((s) => (
                <button type="button" key={s} onClick={() => setNote(s)} className="rounded-full border px-2.5 py-1 text-xs hover:bg-accent cursor-pointer">{s}</button>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPending(null)}>Cancel</Button>
              <Button type="submit" variant={pending?.action === "include" ? "success" : "destructive"} loading={decide.isPending} disabled={!note.trim()}>
                {pending?.action === "include" ? "Include" : "Exclude"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
