import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2 } from "lucide-react";
import { api, type Account, type Dashboard, type ReviewData, type RunBrief, type RunDetail } from "@/lib/api";
import { useAction, useMeta } from "@/lib/hooks";
import { cn, qs } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { RError, RPage } from "@/components/reports/kit";
import { CollectDone, CollectForm, CollectLive, type StartArgs } from "./CollectStep";
import { ReviewActive, ReviewDone, ReviewTeaser, ReviewWaiting, reviewCounts } from "./ReviewStep";
import { pdfUrls, ReportActive, ReportTeaser } from "./ReportStep";
import { MonitorBell, rangeLabel, runLive, Stepper, type StepState } from "./shared";

/**
 * Social monitoring on one page: collect → review → report, stacked top to bottom.
 * The URL holds where you are: `run` (the collection run), `start`/`end`/`campaign_id` before a run starts,
 * and `step` when you've moved between review and report by hand.
 */
export default function MonitorPage() {
  const { t, tf, lang } = useT();
  const [params, setParams] = useSearchParams();
  const { data: meta, error: metaError } = useMeta();
  const runId = Number(params.get("run")) || 0;

  const set = React.useCallback((patch: Record<string, string | number | null>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) v === null || v === "" ? next.delete(k) : next.set(k, String(v));
      return next;
    }, { replace: true });
  }, [setParams]);

  const { data: accounts } = useQuery({ queryKey: ["collect-accounts"], queryFn: () => api.get<Account[]>("/api/collect/accounts") });
  const { data: dash } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/api/dashboard") });
  const { data: runs } = useQuery({ queryKey: ["runs", "latest"], queryFn: () => api.get<RunBrief[]>("/api/runs?limit=5"), enabled: !runId });
  const { data: run, error: runError } = useQuery({
    queryKey: ["run", String(runId)],
    enabled: !!runId,
    queryFn: () => api.get<RunDetail>(`/api/runs/${runId}`),
    refetchInterval: (q) => (q.state.data && runLive(q.state.data) ? 2000 : false),
  });

  // Before a run the period and search term come from the URL; once there's a run, from the run.
  const activeCampaign = meta?.campaigns.find((c) => c.active)?.id ?? meta?.campaigns[0]?.id ?? 0;
  const campaignParam = params.get("campaign_id");
  const campaignId = run ? run.campaign_id ?? 0 : campaignParam === null ? activeCampaign : Number(campaignParam) || 0;
  const start = run?.period_start ?? params.get("start") ?? meta?.default_day ?? "";
  const end = run?.period_end ?? params.get("end") ?? start;
  const campaign = meta?.campaigns.find((c) => c.id === campaignId);
  const termTitle = campaign ? (lang === "en" && campaign.title_en ? campaign.title_en : campaign.title_mr) : undefined;
  const live = !!run && runLive(run);
  const step = params.get("step");
  // Review and report open once the run is over — or straight away when a link asks for a step of an earlier period.
  const collected = run ? !live : !!step;

  const { data: review } = useQuery({
    queryKey: ["review", campaignId, start, end],
    enabled: (!!run || collected) && !!start,
    queryFn: () => api.get<ReviewData>(`/api/review${qs({ campaign_id: campaignId || null, start, end })}`),
    refetchInterval: live ? 6000 : false,
    placeholderData: (prev) => prev,
  });
  const counts = reviewCounts(review);

  const startRun = useAction(
    (a: StartArgs) => api.post<{ id: number }>("/api/runs", {
      campaign_id: a.campaignId || null, start: a.start, end: a.end, account_ids: a.accountIds, overlap_hours: a.overlap, mode: a.mode,
    }),
    { success: (r) => tf("run_started", { n: r.id }), invalidate: [["dashboard"], ["runs"]],
      onSuccess: (r, a) => set({ run: r.id, start: a.start, end: a.end, campaign_id: a.campaignId, step: null }) },
  );
  const retry = useAction(() => api.post<RunDetail>(`/api/runs/${runId}/retry`), {
    success: t("retrying"), invalidate: [["run", String(runId)], ["runs"], ["dashboard"], ["report"]],
  });
  const retryable = !!run && !run.active && run.tasks.some((x) => ["failed", "partial"].includes(x.status));

  // Which of review / report is open: chosen by hand (`step`), else review until nothing is left to decide.
  const reviewOpen = collected && !!review && (step === "review" || (step !== "report" && !!campaignId && counts.left > 0));
  const reportOpen = collected && !!review && !reviewOpen;
  const states: [StepState, StepState, StepState] = [
    run && !live ? "done" : "active", reviewOpen ? "active" : reportOpen ? "done" : "todo", reportOpen ? "active" : "todo"];

  const scrollTo = (id: string) => window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  const newRun = () => { set({ run: null, step: null, start, end, campaign_id: campaignId }); window.scrollTo({ top: 0, behavior: "smooth" }); };

  if (metaError) return <RPage className="mon"><RError error={metaError} /></RPage>;
  if (runError) return <RPage className="mon"><RError error={runError} /></RPage>;
  if (!meta || (runId && !run)) return <RPage className="mon"><div className="flex items-center gap-3 py-16 text-r-muted"><Loader2 className="size-5 animate-spin" />…</div></RPage>;

  const lastSnap = dash?.snapshots[0];
  const otherLive = !runId ? runs?.find((r) => ["queued", "running"].includes(r.status)) : undefined;
  const done = run ? run.tasks.filter((x) => ["complete", "partial", "failed", "skipped"].includes(x.status)).length : 0;
  const pct = run?.tasks.length ? Math.round((done / run.tasks.length) * 100) : 0;
  const urls = pdfUrls(campaignId, start, end);

  return (
    <RPage className="mon mx-auto w-full max-w-[1040px] gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-bold tracking-[0.08em] text-r-muted uppercase">{t("mon_eyebrow")}</div>
          <h1 className="disp m-0 mt-1.5 text-[30px] leading-[1.1] font-bold sm:text-[34px]">{t("mon_title")}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lastSnap && (
            <Link to={`/reports/${lastSnap.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-r-line bg-r-card px-3.5 text-sm font-bold text-r-ink no-underline hover:bg-r-sunk">
              <FileText className="size-4" aria-hidden />
              <span className="hidden sm:inline">{t("mon_last_report")} ·</span> {rangeLabel(lastSnap.period_start, lastSnap.period_end, lang)}
              <span className={cn("rounded-full px-2 py-0.5 text-xs", lastSnap.kind === "final" ? "bg-r-accepted-soft text-r-accepted" : "bg-r-returned-soft text-r-returned-ink")}>
                {lastSnap.kind === "final" ? t("mon_final") : t("mon_draft")}
              </span>
            </Link>
          )}
          <MonitorBell run={run} accounts={accounts} meta={meta} start={start} end={end} />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-r-line bg-r-card px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-2 font-bold">
            <span className={cn("size-2 rounded-full", !run ? "bg-r-faint" : live ? "animate-pulse bg-r-action" : "bg-r-accepted")} />
            {run ? tf("mon_run_n", { n: run.id }) : t("mon_new_run")}
          </span>
          {run ? <>
            <span className="text-r-muted">{rangeLabel(start, end, lang)}</span>
            {termTitle && <span className="text-r-muted">{termTitle}</span>}
          </> : <span className="text-r-muted">{t("mon_not_started")}</span>}
        </div>
        <div className="flex-1" />
        <Stepper states={states} collectNote={live ? `${pct}%` : undefined}
          reviewNote={reviewOpen && campaignId ? `· ${tf("mon_left", { n: counts.left })}` : undefined} />
      </div>

      {otherLive && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-[1.5px] border-r-action/40 bg-r-action-soft px-4 py-3 text-sm">
          <Loader2 className="size-4 animate-spin text-r-action" aria-hidden />
          <b className="flex-1">{tf("mon_active_run", { n: otherLive.id })}</b>
          <Link to={`/monitor${qs({ run: otherLive.id })}`} className="font-bold text-r-action no-underline hover:text-r-action-hover">{t("mon_open")} →</Link>
        </div>
      )}

      <div>
        {!run ? (
          <CollectForm meta={meta} accounts={accounts} start={start} end={end} campaignId={campaignId}
            onPeriod={(s, e) => set({ start: s, end: e })} onCampaign={(id) => set({ campaign_id: id })}
            onStart={(a) => startRun.mutate(a)} starting={startRun.isPending} />
        ) : live ? (
          <CollectLive run={run} accounts={accounts} termTitle={termTitle} />
        ) : (
          <CollectDone run={run} accounts={accounts} onRetry={() => retry.mutate(undefined)} retrying={retry.isPending} />
        )}

        {!run && !collected ? <ReviewTeaser />
          : live || !review ? <ReviewWaiting data={review} hasTerm={!!campaignId} />
          : reviewOpen ? (
            <ReviewActive data={review} campaignId={campaignId} start={start} end={end}
              onContinue={() => { set({ step: "report" }); scrollTo("s3"); }} />
          ) : <ReviewDone data={review} hasTerm={!!campaignId} onReopen={() => { set({ step: "review" }); scrollTo("s2"); }} />}

        {reportOpen ? (
          <ReportActive campaignId={campaignId} start={start} end={end} retrying={retry.isPending}
            onRetry={retryable ? () => retry.mutate(undefined) : undefined}
            onBackToReview={() => { set({ step: "review" }); scrollTo("s2"); }} onNewRun={run ? newRun : undefined} />
        ) : <ReportTeaser waitingOnReview={collected} start={start} end={end} previewUrl={collected ? urls.preview : undefined} />}
      </div>
    </RPage>
  );
}
