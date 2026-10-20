import * as React from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, CalendarDays, Check, ChevronDown, ChevronRight, Info, Loader2, RotateCw, X } from "lucide-react";
import type { Account, Meta, RunDetail, Task } from "@/lib/api";
import { addDays, cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { PLATFORM_LABEL } from "@/lib/status";
import { RButton, RCheck, RInput, RSelect, RTick } from "@/components/reports/kit";
import {
  ActiveCard, dayLabel, duration, Eyebrow, parseIst, PlatformBadge, rangeLabel, StepFrame, TASK_DONE,
} from "./shared";

const PLATFORM_ORDER = ["facebook", "x", "instagram", "youtube"];
const platformRank = (p: string) => { const i = PLATFORM_ORDER.indexOf(p); return i < 0 ? 99 : i; };
const byPlatform = (a: string, b: string) => platformRank(a) - platformRank(b);

export interface StartArgs { start: string; end: string; campaignId: number; accountIds: number[]; mode: "window" | "incremental"; overlap: number | null }

// --------------------------------------------------------------------------- ready to collect
export function CollectForm({ meta, accounts, start, end, campaignId, onPeriod, onCampaign, onStart, starting }: {
  meta: Meta; accounts: Account[] | undefined; start: string; end: string; campaignId: number;
  onPeriod: (start: string, end: string) => void; onCampaign: (id: number) => void;
  onStart: (a: StartArgs) => void; starting: boolean;
}) {
  const { t, tf, name, lang } = useT();
  const yesterday = meta.default_day;
  const presets = [
    { key: "y", label: t("p_yesterday"), start: yesterday, end: yesterday },
    { key: "t", label: t("p_today"), start: addDays(yesterday, 1), end: addDays(yesterday, 1) },
    { key: "w", label: t("p_week"), start: addDays(yesterday, -6), end: yesterday },
  ];
  const matched = presets.find((p) => p.start === start && p.end === end)?.key;
  const [custom, setCustom] = React.useState(!matched);

  const [selected, setSelected] = React.useState<Set<number> | null>(null);
  const sel = React.useMemo(() => selected ?? new Set(accounts?.map((a) => a.id) ?? []), [selected, accounts]);
  const [listOpen, setListOpen] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [mode, setMode] = React.useState<"window" | "incremental">("incremental");
  const [overlap, setOverlap] = React.useState<number | "">("");

  const groups = React.useMemo(() => {
    const out: Record<string, Account[]> = {};
    for (const a of accounts ?? []) (out[a.platform] ??= []).push(a);
    return Object.entries(out).sort(([a], [b]) => byPlatform(a, b));
  }, [accounts]);

  const setMany = (ids: number[], on: boolean) => {
    const next = new Set(sel);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    setSelected(next);
  };

  // A day that's already covered stays call-free only with overlap 0.
  const onCoveredDay = !!meta.covered_day && start === meta.covered_day && end === meta.covered_day;
  const defaultOverlap = onCoveredDay ? 0 : meta.overlap_hours ?? 6;
  const f = filter.trim().toLowerCase();

  const submit = () => onStart({
    start, end, campaignId, accountIds: [...sel], mode,
    overlap: overlap === "" ? (onCoveredDay ? 0 : null) : overlap,
  });

  return (
    <StepFrame n={1} state="active" labelledBy="s1">
      <ActiveCard>
        <div className="px-5 pt-[22px] sm:px-6">
          <Eyebrow tone="focus">{tf("step_of", { n: 1 })}</Eyebrow>
          <h2 id="s1" className="disp m-0 mt-1 text-2xl font-bold">{t("collect_title")}</h2>
        </div>
        <div className="flex flex-col gap-6 px-5 pt-5 pb-6 sm:px-6">
          <div>
            <div className="mb-2.5 text-sm font-bold">{t("mon_period")}</div>
            <div role="radiogroup" aria-label={t("mon_period")} className="flex flex-wrap gap-2">
              {presets.map((p) => {
                const on = !custom && matched === p.key;
                return (
                  <button key={p.key} type="button" role="radio" aria-checked={on} onClick={() => { setCustom(false); onPeriod(p.start, p.end); }}
                    className={cn("flex min-h-14 cursor-pointer flex-col items-start gap-0.5 rounded-[10px] px-4 py-2 text-left",
                      on ? "border-2 border-r-ink bg-r-ink text-r-card" : "border border-r-line bg-r-card text-r-ink hover:bg-r-sunk")}>
                    <span className={cn("text-xs", on ? "opacity-80" : "text-r-muted")}>{p.label}</span>
                    <span className="text-[15px] font-bold">{rangeLabel(p.start, p.end, lang)}</span>
                  </button>
                );
              })}
              <button type="button" role="radio" aria-checked={custom} onClick={() => setCustom(true)}
                className={cn("flex min-h-14 cursor-pointer items-center gap-2 rounded-[10px] px-4 py-2 text-[15px] font-bold",
                  custom ? "border-2 border-r-ink bg-r-ink text-r-card" : "border border-dashed border-r-field bg-transparent text-r-ink hover:bg-r-sunk")}>
                <CalendarDays className="size-4" aria-hidden />{t("p_custom")}
              </button>
            </div>
            {custom && (
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-[13px] font-bold text-r-muted">{t("p_from")}
                  <RInput type="date" value={start} max={end} onChange={(e) => e.target.value && onPeriod(e.target.value, end < e.target.value ? e.target.value : end)} className="w-44" />
                </label>
                <label className="flex flex-col gap-1 text-[13px] font-bold text-r-muted">{t("p_to")}
                  <RInput type="date" value={end} min={start} onChange={(e) => e.target.value && onPeriod(start, e.target.value)} className="w-44" />
                </label>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="mon-term" className="mb-2.5 block text-sm font-bold">{t("mon_term")} <span className="font-normal text-r-muted">· {t("mon_optional")}</span></label>
            <RSelect id="mon-term" value={campaignId} onChange={(e) => onCampaign(Number(e.target.value))} className="h-12 w-full max-w-[520px] rounded-[10px] text-[15px]">
              {meta.campaigns.map((c) => (
                <option key={c.id} value={c.id}>{lang === "en" && c.title_en ? c.title_en : c.title_mr} · {tf("rules_v", { n: c.version })}</option>
              ))}
              <option value={0}>{t("term_none")}</option>
            </RSelect>
          </div>

          <div>
            <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-bold">{t("mon_accounts")} <span className="num font-medium text-r-muted">{sel.size} / {accounts?.length ?? 0}</span></div>
              {!!accounts?.length && (
                <button type="button" onClick={() => setListOpen(!listOpen)} aria-expanded={listOpen}
                  className="cursor-pointer border-0 bg-transparent p-0 text-sm font-bold text-r-action hover:text-r-action-hover">
                  {listOpen ? t("hide_accounts") : t("choose_accounts")}
                </button>
              )}
            </div>
            {accounts && !accounts.length ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-r-field p-4">
                <b>{t("no_accounts")}</b><RButton size="sm" asChild><Link to="/accounts">{t("register_accounts")}</Link></RButton>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2.5">
                {groups.map(([platform, list]) => {
                  const n = list.filter((a) => sel.has(a.id)).length;
                  const all = n === list.length;
                  return (
                    <button key={platform} type="button" role="checkbox" aria-checked={all ? true : n ? "mixed" : false}
                      onClick={() => setMany(list.map((a) => a.id), !all)}
                      className={cn("flex min-h-[60px] cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-r-ink",
                        n ? "border-r-action bg-r-action-soft" : "border-r-line bg-r-card hover:bg-r-sunk")}>
                      <RTick checked={all} mixed={!all && n > 0} />
                      <PlatformBadge platform={platform} className="size-[30px] rounded-lg" />
                      <span className="leading-tight">
                        <span className="block text-sm font-bold">{PLATFORM_LABEL[platform] ?? platform}</span>
                        <span className="num block text-xs text-r-muted">{all ? tf("n_accounts", { n: list.length }) : `${n} / ${list.length}`}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {listOpen && accounts && (
              <div className="mt-3 flex flex-col gap-4 rounded-xl border border-r-line-soft p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <RInput type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("filter_accounts")} aria-label={t("filter_accounts")} className="max-w-64" />
                  <RButton size="sm" variant="ghost" onClick={() => setSelected(new Set(accounts.map((a) => a.id)))}>{t("mon_all")}</RButton>
                  <RButton size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t("mon_none")}</RButton>
                </div>
                {groups.map(([platform, list]) => {
                  const shown = list.filter((a) => !f || `${a.handle} ${a.display_name} ${a.office?.name_mr ?? ""} ${a.office?.name_en ?? ""}`.toLowerCase().includes(f));
                  if (!shown.length) return null;
                  return (
                    <div key={platform}>
                      <div className="mb-2 flex items-center gap-2 text-sm font-bold"><PlatformBadge platform={platform} className="size-5 rounded-[5px] text-[10px]" />{PLATFORM_LABEL[platform] ?? platform}</div>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {shown.map((a) => (
                          <RCheck key={a.id} checked={sel.has(a.id)} onChange={(v) => setMany([a.id], v)} className="min-h-11 justify-start font-normal">
                            <span className="min-w-0 flex-1 leading-tight">
                              <span className="block truncate font-bold">{a.handle}</span>
                              <span className="block truncate text-xs text-r-muted">{a.office ? name(a.office) : t("not_mapped")}</span>
                            </span>
                            {!a.mapping_confirmed && <span className="rounded-full bg-r-returned-soft px-2 py-0.5 text-[11px] font-bold text-r-returned-ink">{t("mon_unconfirmed")}</span>}
                          </RCheck>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <details className="group border-t border-r-line-soft pt-4">
            <summary className="flex cursor-pointer list-none items-center gap-2.5 text-sm text-r-muted [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
              <span className="font-bold text-r-ink">{t("advanced")}</span>
              <span>· {mode === "incremental" ? t("mode_incremental") : t("mode_window")}</span>
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_200px]">
              <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
                {(["incremental", "window"] as const).map((m) => (
                  <RCheck key={m} radio checked={mode === m} onChange={() => setMode(m)} className="min-h-14 items-start py-2.5">
                    <span className="leading-tight"><span className="block font-bold">{t(m === "incremental" ? "mode_incremental" : "mode_window")}</span>
                      <span className="block text-xs font-normal text-r-muted">{t(m === "incremental" ? "mode_incremental_hint" : "mode_window_hint")}</span></span>
                  </RCheck>
                ))}
              </div>
              <label className="flex flex-col gap-1 text-[13px] font-bold text-r-muted">{t("overlap")}
                <RInput type="number" min={0} max={72} value={overlap} placeholder={String(defaultOverlap)}
                  onChange={(e) => setOverlap(e.target.value === "" ? "" : Number(e.target.value))} />
                <span className="text-xs font-normal">{t("overlap_hint")}</span>
              </label>
            </div>
          </details>
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-r-line-soft bg-r-ground/60 px-5 py-[18px] sm:px-6">
          <RButton variant="pri" size="lg" className="px-6 shadow-[0_2px_0_var(--r-action-hover)]" loading={starting} disabled={!sel.size} onClick={submit}>
            {t("start_collection")}<ArrowRight aria-hidden />
          </RButton>
          {onCoveredDay && <span className="text-sm text-r-muted">{t("bell_covered_b")}</span>}
        </div>
      </ActiveCard>
    </StepFrame>
  );
}

// --------------------------------------------------------------------------- live / finished
type TaskState = "done" | "running" | "queued" | "failed";
function taskState(task: Task): TaskState {
  if (task.status === "running") return "running";
  if (!TASK_DONE.includes(task.status)) return "queued";
  return task.status === "failed" || task.window_complete === false ? "failed" : "done";
}

function useOffices(accounts: Account[] | undefined) {
  return React.useMemo(() => new Map((accounts ?? []).map((a) => [`${a.platform}:${a.handle}`, a.office])), [accounts]);
}

function useTick(on: boolean) {
  const [, set] = React.useState(0);
  React.useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => set((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [on]);
}

function PlatformRows({ tasks }: { tasks: Task[] }) {
  const groups = React.useMemo(() => {
    const out: Record<string, Task[]> = {};
    tasks.forEach((x) => (out[x.platform] ??= []).push(x));
    return Object.entries(out).sort(([a], [b]) => byPlatform(a, b));
  }, [tasks]);
  return (
    <div className="flex flex-col gap-2.5">
      {groups.map(([platform, list]) => (
        <div key={platform} className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-xl border border-r-line-soft px-3.5 py-2.5">
          <div className="flex w-[140px] items-center gap-2.5"><PlatformBadge platform={platform} /><span className="text-sm font-bold">{PLATFORM_LABEL[platform] ?? platform}</span></div>
          <div aria-hidden className="flex flex-[1_1_260px] flex-wrap gap-[5px]">
            {list.map((x) => {
              const s = taskState(x);
              return <span key={x.id} title={x.handle} className={cn("size-5 rounded-[5px]",
                s === "done" && "bg-r-accepted", s === "failed" && "bg-r-overdue",
                s === "running" && "animate-pulse bg-r-action", s === "queued" && "border border-r-field")} />;
            })}
          </div>
          <div className="num min-w-12 text-right text-sm font-semibold">{list.filter((x) => TASK_DONE.includes(x.status)).length}/{list.length}</div>
        </div>
      ))}
    </div>
  );
}

function TaskRow({ task, office, first }: { task: Task; office?: string; first?: boolean }) {
  const { t, tf } = useT();
  const s = taskState(task);
  return (
    <li className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-2 px-3.5 py-3", !first && "border-t border-r-line-soft", s === "running" && "bg-r-action-soft")}>
      {s === "running" ? <Loader2 className="size-4 animate-spin text-r-action" aria-hidden />
        : s === "done" ? <Check className="size-4 text-r-accepted" strokeWidth={2.6} aria-hidden />
        : s === "failed" ? <X className="size-4 text-r-overdue" strokeWidth={2.6} aria-hidden />
        : <span className="size-4 rounded-full border-2 border-r-field" aria-hidden />}
      <span className="text-sm font-bold">{task.handle}</span>
      <span className="text-[13px] text-r-muted">{office ? `${office} · ` : ""}{PLATFORM_LABEL[task.platform] ?? task.platform}</span>
      <span className="flex-1" />
      {s === "running" ? <span className="text-[13px] text-r-action">{task.progress || t("reading")}</span>
        : s === "failed" ? <span className="text-[13px] text-r-overdue-ink">{task.error_kind ? task.error_kind.replace(/_/g, " ") : t("cov_not")}{task.error ? ` — ${task.error}` : task.coverage_note ? ` — ${task.coverage_note}` : ""}</span>
        : s === "done" ? <span className="num text-[13px] text-r-muted">{tf("posts_new", { a: task.in_window, b: task.new })}</span>
        : <span className="text-[13px] text-r-muted">{t("lg_queued")}</span>}
    </li>
  );
}

function TaskList({ tasks, accounts, limit }: { tasks: Task[]; accounts?: Account[]; limit?: number }) {
  const { t, tf, name } = useT();
  const offices = useOffices(accounts);
  const [all, setAll] = React.useState(false);
  const rank: Record<TaskState, number> = { running: 0, failed: 1, done: 2, queued: 3 };
  const sorted = [...tasks].sort((a, b) => rank[taskState(a)] - rank[taskState(b)] || b.id - a.id);
  const shown = all || !limit ? sorted : sorted.slice(0, limit);
  return (
    <div>
      <ul className="m-0 list-none overflow-hidden rounded-xl border border-r-line-soft p-0">
        {shown.map((x, i) => <TaskRow key={x.id} task={x} first={i === 0} office={name(offices.get(`${x.platform}:${x.handle}`))} />)}
      </ul>
      {!!limit && tasks.length > limit && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2.5 cursor-pointer border-0 bg-transparent p-0 text-sm font-bold text-r-action hover:text-r-action-hover">
          {all ? t("show_fewer") : tf("show_all_accounts", { n: tasks.length })}
        </button>
      )}
    </div>
  );
}

function runTotals(run: RunDetail) {
  const done = run.tasks.filter((x) => TASK_DONE.includes(x.status)).length;
  const failed = run.tasks.filter((x) => taskState(x) === "failed");
  const running = run.tasks.filter((x) => x.status === "running").length;
  const sum = run.tasks.reduce((a, x) => ({ inw: a.inw + x.in_window, nw: a.nw + x.new, upd: a.upd + x.updated }), { inw: 0, nw: 0, upd: 0 });
  return { done, failed, running, ...sum, n: run.tasks.length };
}

export function CollectLive({ run, accounts, termTitle }: { run: RunDetail; accounts?: Account[]; termTitle?: string }) {
  const { t, tf, lang } = useT();
  useTick(true);
  const s = runTotals(run);
  const pct = s.n ? Math.round((s.done / s.n) * 100) : 0;
  const started = parseIst(run.started_at) ?? parseIst(run.created_at);
  const day = run.period_start === run.period_end ? dayLabel(run.period_start, lang) : rangeLabel(run.period_start, run.period_end, lang);
  const w = (k: number) => `${s.n ? (k / s.n) * 100 : 0}%`;

  return (
    <StepFrame n={1} state="active" busy labelledBy="s1">
      <ActiveCard>
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-[22px] sm:px-6">
          <div>
            <Eyebrow tone="focus">{tf("step_of", { n: 1 })}</Eyebrow>
            <h2 id="s1" className="disp m-0 mt-1 text-2xl font-bold">{t("collecting_title")}</h2>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-r-muted">
              <span className="rounded-full bg-r-line-soft px-2.5 py-1">{day}</span>
              {termTitle && <span className="rounded-full bg-r-line-soft px-2.5 py-1">{termTitle}</span>}
              <span className="rounded-full bg-r-line-soft px-2.5 py-1">{tf("n_accounts", { n: s.n })}</span>
              <span className="rounded-full bg-r-line-soft px-2.5 py-1">{run.mode === "incremental" ? t("mode_incremental") : t("mode_window")}</span>
            </div>
          </div>
          {started && (
            <div className="text-right">
              <div className="num text-[22px] font-semibold">{duration(Date.now() - started.getTime())}</div>
              <div className="text-xs text-r-muted">{t("elapsed")}</div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-[22px] px-5 pt-5 pb-6 sm:px-6">
          <div>
            <div className="mb-2 flex items-baseline justify-between text-sm"><b>{tf("accounts_done", { a: s.done, b: s.n })}</b><span className="num text-r-muted">{pct}%</span></div>
            <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("mon_progress")} className="flex h-3 overflow-hidden rounded-full bg-r-sunk">
              <div className="bg-r-accepted transition-[width] duration-500" style={{ width: w(s.done - s.failed.length) }} />
              <div className="bg-r-overdue transition-[width] duration-500" style={{ width: w(s.failed.length) }} />
              <div className="animate-pulse bg-r-seq-3 transition-[width] duration-500" style={{ width: w(s.running) }} />
            </div>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
            <Tile label={run.period_start === run.period_end ? tf("st_posts_in", { day: dayLabel(run.period_start, lang) }) : t("mon_period")} value={s.inw} />
            <Tile label={t("st_new")} value={s.nw} tone="good" />
            <Tile label={t("st_updated")} value={s.upd} />
            <Tile label={t("st_failed")} value={s.failed.length} tone={s.failed.length ? "bad" : undefined} />
          </div>

          <div>
            <div className="mb-3 flex flex-wrap justify-between gap-2">
              <div className="text-sm font-bold">{t("by_platform")}</div>
              <div className="flex flex-wrap gap-3.5 text-xs text-r-muted">
                <Legend cls="bg-r-accepted" label={t("lg_done")} />
                <Legend cls="animate-pulse bg-r-action" label={t("lg_collecting")} />
                <Legend cls="border border-r-field bg-r-card" label={t("lg_queued")} />
                <Legend cls="bg-r-overdue" label={t("st_failed")} />
              </div>
            </div>
            <PlatformRows tasks={run.tasks} />
          </div>

          <div>
            <div className="mb-2.5 text-sm font-bold">{t("latest_activity")}</div>
            <TaskList tasks={run.tasks} accounts={accounts} limit={4} />
          </div>
        </div>

        <div className="flex items-center gap-2.5 border-t border-r-line-soft bg-r-ground/60 px-5 py-3.5 text-[13px] text-r-muted sm:px-6">
          <Info className="size-4 shrink-0" aria-hidden /><span>{t("leave_note")}</span>
        </div>
      </ActiveCard>
    </StepFrame>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  const { num } = useT();
  return (
    <div className={cn("rounded-xl border px-3.5 py-3", tone === "bad" ? "border-r-overdue/30 bg-r-overdue-soft" : "border-r-line-soft bg-r-ground/60")}>
      <div className={cn("text-xs", tone === "bad" ? "text-r-overdue-ink" : "text-r-muted")}>{label}</div>
      <div className={cn("num text-[26px] font-semibold", tone === "good" && "text-r-accepted", tone === "bad" && "text-r-overdue")}>{num(value)}</div>
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={cn("box-border size-3 rounded-[3px]", cls)} />{label}</span>;
}

/** Step 1 once the run has finished: one line, details on demand. */
export function CollectDone({ run, accounts, onRetry, retrying }: { run: RunDetail; accounts?: Account[]; onRetry: () => void; retrying: boolean }) {
  const { t, tf, lang, num } = useT();
  const [open, setOpen] = React.useState(false);
  const s = runTotals(run);
  const covered = s.n - s.failed.length;
  const a = parseIst(run.started_at), b = parseIst(run.finished_at);
  const took = a && b ? b.getTime() - a.getTime() : null;
  const stopped = ["interrupted", "failed"].includes(run.status);

  return (
    <StepFrame n={1} state="done" labelledBy="s1">
      <div className="rounded-2xl border border-r-line bg-r-card">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
          <div className="min-w-0 flex-[1_1_320px]">
            <h2 id="s1" className="m-0 text-[17px] font-bold">
              {stopped ? t("run_stopped") : tf("collected_summary", { a: num(s.inw), b: s.n, c: covered })}
            </h2>
            <div className="mt-0.5 text-[13px] text-r-muted">
              {rangeLabel(run.period_start, run.period_end, lang)} · {tf("mon_run_n", { n: run.id }).toLowerCase()}
              {took !== null && ` · ${tf("finished_in", { d: took < 60_000 ? "< 1 min" : `${Math.round(took / 60_000)} min` })}`}
            </div>
          </div>
          {s.failed.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-r-overdue-soft px-2.5 py-1 text-xs font-bold text-r-overdue-ink">
              <AlertCircle className="size-[13px]" aria-hidden />
              {s.failed.length === 1 ? tf("not_covered_one", { h: s.failed[0].handle, p: PLATFORM_LABEL[s.failed[0].platform] ?? s.failed[0].platform }) : tf("not_covered_many", { n: s.failed.length })}
            </span>
          )}
          {s.failed.length > 0 && (
            <RButton size="sm" loading={retrying} onClick={onRetry}><RotateCw aria-hidden />{s.failed.length === 1 ? t("retry_one") : tf("retry_many", { n: s.failed.length })}</RButton>
          )}
          <RButton size="icon" variant="ghost" aria-expanded={open} aria-label={open ? t("hide_details") : t("show_details")} onClick={() => setOpen(!open)}>
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden />
          </RButton>
        </div>
        {open && (
          <div className="flex flex-col gap-4 border-t border-r-line-soft px-5 py-5 sm:px-6">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
              <Tile label={t("mon_period")} value={s.inw} />
              <Tile label={t("st_new")} value={s.nw} tone="good" />
              <Tile label={t("st_updated")} value={s.upd} />
              <Tile label={t("st_failed")} value={s.failed.length} tone={s.failed.length ? "bad" : undefined} />
            </div>
            <PlatformRows tasks={run.tasks} />
            <TaskList tasks={run.tasks} accounts={accounts} limit={8} />
            <p className="m-0 text-xs text-r-muted">{run.mode} · {run.overlap_hours}h overlap · {run.triggered_by || "—"} · {run.created_at}</p>
          </div>
        )}
      </div>
    </StepFrame>
  );
}
