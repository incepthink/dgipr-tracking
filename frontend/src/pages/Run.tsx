import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, CheckCircle2, CircleDashed, Loader2, RotateCcw, XCircle } from "lucide-react";
import { api, type RunDetail, type Task } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { cn, dmyText, periodLabel, qs } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, StatusBadge, Tip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Callout, ErrorState, LoadingRows, PageHeader, PlatformIcon } from "@/components/common";

const DONE = ["complete", "partial", "failed", "skipped"];

function Coverage({ t }: { t: Task }) {
  if (t.status === "running")
    return <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary"><Loader2 className="size-3.5 animate-spin" /> Collecting…</span>;
  if (t.status === "pending")
    return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><CircleDashed className="size-3.5" /> Queued</span>;
  if (t.window_complete === null)
    return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><CircleDashed className="size-3.5" /> Not yet known</span>;
  return t.window_complete ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success"><CheckCircle2 className="size-3.5" /> Fully covered</span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-danger"><XCircle className="size-3.5" /> Not covered</span>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-semibold tabular", tone)}>{value}</div>
    </div>
  );
}

export default function RunPage() {
  const { id } = useParams();
  const { data: run, isLoading, error } = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.get<RunDetail>(`/api/runs/${id}`),
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && (d.active || ["queued", "running"].includes(d.status)) ? 2000 : false;
    },
  });
  const retry = useAction(() => api.post<RunDetail>(`/api/runs/${id}/retry`), {
    success: "Retrying failed tasks", invalidate: [["run", id], ["runs"], ["dashboard"]],
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading || !run) return <LoadingRows rows={6} />;

  const done = run.tasks.filter((t) => DONE.includes(t.status)).length;
  const pct = run.tasks.length ? Math.round((done / run.tasks.length) * 100) : 0;
  const live = run.active || ["queued", "running"].includes(run.status);
  const retryable = !run.active && run.tasks.some((t) => ["failed", "partial"].includes(t.status));
  const uncovered = run.tasks.filter((t) => t.window_complete === false).length;
  const totals = run.tasks.reduce((a, t) => ({ inw: a.inw + t.in_window, nw: a.nw + t.new, upd: a.upd + t.updated }), { inw: 0, nw: 0, upd: 0 });
  const reviewLink = `/review${qs({ campaign_id: run.campaign_id, start: run.period_start, end: run.period_end })}`;

  return (
    <>
      <PageHeader
        step={1}
        title={<span className="flex flex-wrap items-center gap-3">Collection run #{run.id} <StatusBadge status={run.status} /></span>}
        description={<>Reporting period <b className="text-foreground">{periodLabel(run.period_start, run.period_end)}</b> · {run.mode} mode · {run.overlap_hours}h overlap · started by {run.triggered_by || "—"} at {dmyText(run.created_at)}</>}
        actions={<>
          {retryable && <Button variant="outline" loading={retry.isPending} onClick={() => retry.mutate(undefined)}><RotateCcw /> Retry failed tasks</Button>}
          {live ? <Button disabled>Continue to review <ArrowRight /></Button>
            : <Button asChild><Link to={reviewLink}>Continue to review <ArrowRight /></Link></Button>}
        </>}
      />

      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div className="min-w-56 flex-1">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium">
                {live && <Loader2 className="size-4 animate-spin text-primary" />}
                {live ? "Collecting…" : "Finished"}
              </span>
              <span className="text-muted-foreground tabular">{done}/{run.tasks.length} tasks</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full transition-all duration-500", uncovered ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="flex gap-8">
            <Stat label="In period" value={totals.inw} />
            <Stat label="New" value={totals.nw} tone="text-success" />
            <Stat label="Updated" value={totals.upd} />
          </div>
        </div>
      </Card>

      {!live && uncovered > 0 && (
        <Callout tone="danger" className="mb-6" title={`${uncovered} task${uncovered > 1 ? "s" : ""} did not fully cover the period`}>
          A failed or stopped task never counts as "zero posts" — the affected report cells stay incomplete and block final approval. Retry them, or check provider credentials.
        </Callout>
      )}

      <Card>
        <CardHeader><CardTitle>Tasks</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {run.tasks.map((t) => (
            <div key={t.id} className={cn("rounded-lg border p-4", t.status === "failed" && "border-danger/30 bg-danger-soft/30",
              t.status === "running" && "border-primary/40 bg-primary/[0.04]")}>
              <div className="flex flex-wrap items-center gap-3">
                <PlatformIcon platform={t.platform} className="size-8 text-xs" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{t.handle}</div>
                  <div className="truncate text-xs text-muted-foreground">{t.provider}</div>
                </div>
                <Coverage t={t} />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
                <Stat label="Posts" value={t.in_window} />
                {t.new > 0 && <Stat label="New" value={t.new} tone="text-success" />}
                {t.updated > 0 && <Stat label="Updated" value={t.updated} />}
                {t.unparseable > 0 && <Stat label="Unparsed" value={t.unparseable} tone="text-warning" />}
                {Object.keys(t.usage ?? {}).length > 0 && (
                  <Tip content={<div className="space-y-0.5">{Object.entries(t.usage).map(([k, v]) => <div key={k}>{k}: {String(v)}</div>)}</div>}>
                    <div className="cursor-help">
                      <div className="text-[11px] text-muted-foreground">Usage</div>
                      <div className="text-sm font-semibold text-primary">details</div>
                    </div>
                  </Tip>
                )}
              </div>
              {(t.error || (t.window_complete !== true && (t.progress || t.coverage_note))) && (
                <div className="mt-3 space-y-1 text-xs">
                  {t.error ? (
                    <div className="flex gap-1.5 text-danger"><AlertCircle className="mt-px size-3.5 shrink-0" /><span><b>{t.error_kind}</b>: {t.error}</span></div>
                  ) : t.window_complete !== true && t.progress && <div className="text-muted-foreground">{t.progress}</div>}
                  {t.window_complete !== true && t.coverage_note && <div className="text-muted-foreground">{t.coverage_note}</div>}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <p className="mt-4 text-xs text-muted-foreground">
        Retrieval window {run.window_start_utc} → {run.window_end_utc} UTC · trigger: {run.trigger_source}
      </p>
    </>
  );
}
