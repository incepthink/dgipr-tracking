import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, CheckCheck, Eye, FileSearch, X } from "lucide-react";
import { api, type Cls, type ReviewData, type ReviewRow } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { useT, type TKey } from "@/lib/i18n";
import { labelOf, PLATFORM_LABEL } from "@/lib/status";
import { RButton, RSelect, RSheet, RTextarea } from "@/components/reports/kit";
import { ActiveCard, Eyebrow, Kbd, PendingCard, PlatformBadge, StepFrame } from "./shared";

const PAGE = 10;

/** Posts a person still has to look at: uncertain ones, and suggested matches nobody has confirmed. */
export function isSuggested(r: ReviewRow) {
  return !!r.cls && !r.cls.manual_decision && r.counts && (r.eff === "pending" || r.cls.auto_decision === "match");
}

export function reviewCounts(data: ReviewData | undefined) {
  const rows = data?.rows ?? [];
  const suggested = rows.filter(isSuggested);
  const proposed = suggested.filter((r) => r.cls!.auto_decision === "match").length;
  const included = rows.filter((r) => r.counts && r.eff === "include" && !isSuggested(r)).length;
  return {
    total: rows.length, left: suggested.length, proposed, uncertain: suggested.length - proposed, included,
    excluded: rows.length - suggested.length - included,
    strong: rows.filter((r) => r.cls?.auto_decision === "match").length,
    pending: rows.filter((r) => r.counts && r.cls && r.eff === "pending").length,
  };
}

const AUTO_BADGE: Record<string, { key: TKey; cls: string }> = {
  match: { key: "b_suggested", cls: "bg-r-accepted-soft text-r-accepted" },
  needs_review: { key: "b_uncertain", cls: "bg-r-returned-soft text-r-returned-ink" },
  insufficient_text: { key: "b_little_text", cls: "bg-r-returned-soft text-r-returned-ink" },
  no_match: { key: "b_no_match", cls: "bg-r-sunk text-r-muted" },
};

// --------------------------------------------------------------------------- placeholders before review opens
export function ReviewTeaser() {
  const { t } = useT();
  return (
    <StepFrame n={2} state="todo" labelledBy="s2">
      <PendingCard id="s2" eyebrow={t("step2_after")} title={t("review_title")}
        aside={<div className="flex flex-wrap gap-1.5">{(["b_strong", "b_uncertain", "b_no_match"] as TKey[]).map((k) => (
          <span key={k} className="rounded-full bg-r-sunk px-2.5 py-1.5 text-xs font-bold text-r-muted">{t(k)}</span>))}</div>}>
        <p className="m-0 mt-1.5 text-sm text-r-muted">{t("review_teaser")}</p>
      </PendingCard>
    </StepFrame>
  );
}

export function ReviewWaiting({ data, hasTerm }: { data?: ReviewData; hasTerm: boolean }) {
  const { t, tf } = useT();
  const c = reviewCounts(data);
  return (
    <StepFrame n={2} state="todo" labelledBy="s2">
      <PendingCard solid id="s2" eyebrow={t("step2_opens")} title={t("review_title")}
        aside={hasTerm && data ? (
          <div className="flex flex-wrap gap-1.5">
            <span className="num rounded-full bg-r-accepted-soft px-2.5 py-1.5 text-xs font-semibold text-r-accepted">{tf("strong_so_far", { n: c.strong })}</span>
            <span className="num rounded-full bg-r-returned-soft px-2.5 py-1.5 text-xs font-semibold text-r-returned-ink">{tf("n_uncertain", { n: c.pending })}</span>
          </div>
        ) : undefined}>
        <p className="m-0 mt-2 mb-3.5 text-sm text-r-muted">{hasTerm ? t("sorting_note") : t("no_term_review")}</p>
        <div aria-hidden className="flex flex-col gap-2">
          {[100, 92, 84].map((w) => <div key={w} className="h-11 animate-pulse rounded-[10px] bg-r-line-soft" style={{ width: `${w}%` }} />)}
        </div>
      </PendingCard>
    </StepFrame>
  );
}

/** Step 2 once it's behind you. */
export function ReviewDone({ data, hasTerm, onReopen }: { data?: ReviewData; hasTerm: boolean; onReopen: () => void }) {
  const { t, tf } = useT();
  const c = reviewCounts(data);
  return (
    <StepFrame n={2} state="done" labelledBy="s2">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-r-line bg-r-card px-5 py-4 sm:px-6">
        <div className="min-w-0 flex-[1_1_320px]">
          <h2 id="s2" className="m-0 text-[17px] font-bold">{t("review_done")}</h2>
          <div className="mt-0.5 text-[13px] text-r-muted">
            {hasTerm ? tf("reviewed_summary", { a: c.included + c.proposed, b: c.excluded }) : t("no_term_review")}
            {hasTerm && c.uncertain > 0 && <span className="font-bold text-r-returned-ink"> · {tf("still_undecided", { n: c.uncertain })}</span>}
          </div>
        </div>
        <RButton size="sm" onClick={onReopen}>{t("change_decisions")}</RButton>
      </div>
    </StepFrame>
  );
}

// --------------------------------------------------------------------------- the review itself
type Decide = { cls: Cls; pubId: number; action: "include" | "exclude" | "reset"; note?: string; report_tag?: string };

function needsNote(cls: Cls, action: string) {
  return (action === "include" && cls.auto_decision !== "match") || (action === "exclude" && cls.auto_decision !== "no_match");
}

export function ReviewActive({ data, campaignId, start, end, onContinue }: {
  data: ReviewData; campaignId: number; start: string; end: string; onContinue: () => void;
}) {
  const { t, tf, name, num } = useT();
  const [tab, setTab] = React.useState<"suggested" | "all">("suggested");
  const [platform, setPlatform] = React.useState("");
  const [office, setOffice] = React.useState("");
  const [shown, setShown] = React.useState(PAGE);
  const [recent, setRecent] = React.useState<Map<number, "include" | "exclude">>(new Map());
  const [current, setCurrent] = React.useState(0);
  const [pending, setPending] = React.useState<Decide | null>(null);
  const [note, setNote] = React.useState("");
  const c = reviewCounts(data);
  const hasTerm = !!campaignId;

  const rows = React.useMemo(() => data.rows.filter((r) =>
    (tab === "all" || isSuggested(r) || recent.has(r.pub.id)) && (!platform || r.pub.platform === platform) && (!office || r.pub.office?.code === office),
  ), [data.rows, tab, platform, office, recent]);
  const visible = rows.slice(0, shown);
  // Cards still waiting on a decision (collapsed "decided just now" rows are skipped by J/K).
  const open = visible.filter((r) => !recent.has(r.pub.id));
  const cur = open[Math.min(current, open.length - 1)];

  const platforms = React.useMemo(() => [...new Set(data.rows.map((r) => r.pub.platform))], [data.rows]);
  const offices = React.useMemo(() => {
    const m = new Map<string, { code: string; name_mr: string; name_en: string }>();
    data.rows.forEach((r) => r.pub.office && m.set(r.pub.office.code, r.pub.office));
    return [...m.values()].sort((a, b) => a.name_mr.localeCompare(b.name_mr));
  }, [data.rows]);

  const decide = useAction(
    (d: Decide) => api.post<Cls>(`/api/review/${d.cls.id}`, { action: d.action, note: d.note ?? "", report_tag: d.report_tag ?? "__keep__" }),
    {
      invalidate: [["review"], ["report"], ["dashboard"]],
      onSuccess: (_r, d) => {
        setPending(null); setNote("");
        setRecent((m) => {
          const next = new Map(m);
          if (d.action === "reset") next.delete(d.pubId); else next.set(d.pubId, d.action);
          return next;
        });
      },
    },
  );
  const bulk = useAction(
    () => api.post<{ accepted: number }>("/api/review/bulk-accept", { campaign_id: campaignId, start, end }),
    { success: (r) => tf("accepted_toast", { n: r.accepted }), invalidate: [["review"], ["report"], ["dashboard"]] },
  );

  const onDecide = React.useCallback((d: Decide) => {
    if (d.action !== "reset" && needsNote(d.cls, d.action)) { setPending(d); setNote(""); return; }
    decide.mutate(d);
  }, [decide]);

  // J/K move, I include, E exclude, O open — not while typing or with the note dialog open.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pending || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      const k = e.key.toLowerCase();
      if (k === "j" || k === "k") {
        e.preventDefault();
        const i = Math.max(0, Math.min(open.length - 1, current + (k === "j" ? 1 : -1)));
        setCurrent(i);
        document.getElementById(`rv${open[i]?.pub.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else if ((k === "i" || k === "e") && cur?.cls && !decide.isPending) {
        e.preventDefault();
        onDecide({ cls: cur.cls, pubId: cur.pub.id, action: k === "i" ? "include" : "exclude" });
      } else if (k === "o" && cur) {
        window.open(cur.pub.url, "_blank", "noopener");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, current, cur, pending, onDecide, decide.isPending]);

  const pct = (n: number) => `${c.total ? (n / c.total) * 100 : 0}%`;

  return (
    <StepFrame n={2} state="active" labelledBy="s2">
      <ActiveCard className="pb-20 sm:pb-0">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-[22px] sm:px-6">
          <div>
            <Eyebrow tone="focus">{tf("step_of", { n: 2 })}</Eyebrow>
            <h2 id="s2" className="disp m-0 mt-1 text-2xl font-bold">{t("review_title")}</h2>
          </div>
          {hasTerm && (
            <div className="text-right">
              <div className="num text-[30px] leading-none font-semibold">{num(c.left)}</div>
              <div className="mt-1 text-xs text-r-muted">{t("left_to_decide")}</div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-5 px-5 pt-5 pb-6 sm:px-6">
          {hasTerm ? (
            <div>
              <div role="img" aria-label={`${t("r_included")} ${c.included}, ${t("r_excluded")} ${c.excluded}, ${t("r_to_decide")} ${c.left} / ${c.total}`}
                className="flex h-3 overflow-hidden rounded-full bg-r-sunk">
                <div className="bg-r-accepted transition-[width] duration-500" style={{ width: pct(c.included) }} />
                <div className="bg-r-faint transition-[width] duration-500" style={{ width: pct(c.excluded) }} />
                <div className="bg-r-focus transition-[width] duration-500" style={{ width: pct(c.left) }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-r-muted">
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-r-accepted" />{t("r_included")} <b className="num text-r-ink">{c.included}</b></span>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-r-faint" />{t("r_excluded")} <b className="num text-r-ink">{c.excluded}</b></span>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-r-focus" />{t("r_to_decide")} <b className="num text-r-ink">{c.left}</b></span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-r-line bg-r-ground/60 p-3.5 text-sm">{t("no_term_review")}</div>
          )}

          {c.proposed > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-r-action/25 bg-r-action-soft px-4 py-3">
              <CheckCheck className="size-5 shrink-0 text-r-action" aria-hidden />
              <div className="min-w-0 flex-[1_1_280px] text-sm"><b>{tf("clear_banner_b", { n: c.proposed })}</b>{" "}
                <span className="text-r-muted">{tf("clear_banner_s", { m: c.uncertain })}</span></div>
              <RButton variant="pri" size="sm" loading={bulk.isPending} onClick={() => bulk.mutate(undefined)}>{tf("mon_accept_all", { n: c.proposed })}</RButton>
            </div>
          )}

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div role="tablist" aria-label={t("filter_posts")} className="flex gap-[3px] rounded-[10px] bg-r-sunk p-[3px]">
              {([["suggested", t("tab_suggested"), c.left], ["all", t("mon_all"), c.total]] as const).map(([v, label, n]) => (
                <button key={v} role="tab" type="button" aria-selected={tab === v} onClick={() => { setTab(v); setShown(PAGE); setCurrent(0); }}
                  className={cn("min-h-9 cursor-pointer rounded-lg border-0 px-3 text-sm font-bold", tab === v ? "bg-r-card text-r-ink shadow-xs" : "bg-transparent text-r-muted hover:text-r-ink")}>
                  {label} <span className="num font-medium text-r-muted">{n}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2.5">
              <label className="flex flex-col gap-1 text-[13px] font-bold text-r-muted">{t("mon_platform")}
                <RSelect value={platform} onChange={(e) => { setPlatform(e.target.value); setShown(PAGE); }}>
                  <option value="">{t("all_platforms")}</option>
                  {platforms.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p] ?? p}</option>)}
                </RSelect>
              </label>
              <label className="flex flex-col gap-1 text-[13px] font-bold text-r-muted">{t("mon_office")}
                <RSelect value={office} onChange={(e) => { setOffice(e.target.value); setShown(PAGE); }} className="max-w-52">
                  <option value="">{t("all_offices")}</option>
                  {offices.map((o) => <option key={o.code} value={o.code}>{name(o)}</option>)}
                </RSelect>
              </label>
            </div>
          </div>

          {!rows.length ? (
            <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-r-field p-5">
              <FileSearch className="size-6 text-r-muted" aria-hidden />
              <b>{tab === "suggested" && data.rows.length ? t("nothing_to_decide") : t("no_posts")}</b>
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {visible.map((r) => recent.has(r.pub.id) ? (
                <DecidedRow key={r.pub.id} row={r} action={recent.get(r.pub.id)!} busy={decide.isPending}
                  onUndo={() => r.cls && decide.mutate({ cls: r.cls, pubId: r.pub.id, action: "reset" })} />
              ) : (
                <PostCard key={r.pub.id} row={r} current={r === cur} busy={decide.isPending} hasTerm={hasTerm}
                  onFocus={() => setCurrent(open.indexOf(r))}
                  onDecide={(action, tag) => r.cls && onDecide({ cls: r.cls, pubId: r.pub.id, action, report_tag: tag })} />
              ))}
            </ul>
          )}
          {rows.length > shown && (
            <div className="flex justify-center">
              <RButton onClick={() => setShown(shown + PAGE * 2)}>{tf("show_more_n", { n: rows.length - shown })}</RButton>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-r-line-soft bg-r-ground/60 px-5 py-4 sm:px-6">
          {hasTerm && (
            <div className="hidden flex-wrap gap-3 text-xs text-r-muted lg:flex">
              <span><Kbd>J</Kbd> <Kbd>K</Kbd> {t("kb_move")}</span><span><Kbd>I</Kbd> {t("kb_include")}</span>
              <span><Kbd>E</Kbd> {t("kb_exclude")}</span><span><Kbd>O</Kbd> {t("kb_open")}</span>
            </div>
          )}
          <div className="flex-1" />
          {c.uncertain > 0 && <span className="text-[13px] text-r-muted">{t("undecided_note")}</span>}
          <RButton variant="pri" onClick={onContinue}>{t("continue_report")}<ArrowRight aria-hidden /></RButton>
        </div>
      </ActiveCard>

      {hasTerm && cur?.cls && (
        <div className="rpt mon fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 gap-2.5 border-t border-r-line bg-r-card px-4 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] sm:hidden">
          <RButton size="lg" className="min-h-14 rounded-[14px]" disabled={decide.isPending}
            onClick={() => onDecide({ cls: cur.cls!, pubId: cur.pub.id, action: "exclude" })}><X strokeWidth={2.6} aria-hidden />{t("exclude")}</RButton>
          <RButton size="lg" className="min-h-14 rounded-[14px] border-r-accepted bg-r-accepted text-white hover:bg-r-accepted/90" disabled={decide.isPending}
            onClick={() => onDecide({ cls: cur.cls!, pubId: cur.pub.id, action: "include" })}><Check strokeWidth={2.6} aria-hidden />{t("include")}</RButton>
        </div>
      )}

      <RSheet open={!!pending} onClose={() => setPending(null)} closeLabel={t("close")}
        title={pending?.action === "include" ? t("note_title_inc") : t("note_title_exc")}
        description={pending ? tf("note_body", { s: t(AUTO_BADGE[pending.cls.auto_decision]?.key ?? "b_uncertain") }) : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <RButton variant="ghost" onClick={() => setPending(null)}>{t("mon_cancel")}</RButton>
            <RButton variant={pending?.action === "include" ? "pri" : "danger"} loading={decide.isPending} disabled={!note.trim()}
              onClick={() => pending && note.trim() && decide.mutate({ ...pending, note: note.trim() })}>
              {pending?.action === "include" ? t("include") : t("exclude")}
            </RButton>
          </div>
        }>
        <RTextarea autoFocus rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t("note_title_inc")} />
        <div className="flex flex-wrap gap-1.5">
          {(pending?.action === "include" ? ["note_c1", "note_c2"] as const : ["note_c3", "note_c4", "note_c5"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setNote(t(k))}
              className="min-h-9 cursor-pointer rounded-full border border-r-line bg-r-card px-3 text-sm hover:bg-r-sunk">{t(k)}</button>
          ))}
        </div>
      </RSheet>
    </StepFrame>
  );
}

function Highlighted({ parts }: { parts: [string, boolean][] }) {
  return <>{parts.map(([seg, hit], i) => hit
    ? <mark key={i} className="rounded-[3px] bg-(--mon-mark) px-[3px] text-(--mon-mark-ink)">{seg}</mark>
    : <React.Fragment key={i}>{seg}</React.Fragment>)}</>;
}

function PostText({ row }: { row: ReviewRow }) {
  const { t } = useT();
  const [more, setMore] = React.useState(false);
  const fields = Object.entries(row.highlight);
  if (!fields.length) return <p className="m-0 text-sm text-r-muted italic">{t("no_text")}</p>;
  const long = fields.reduce((n, [, parts]) => n + parts.reduce((m, [s]) => m + s.length, 0), 0) > 420;
  return (
    <div>
      <div className={cn("flex flex-col gap-1.5 text-base leading-[1.7] whitespace-pre-wrap", !more && long && "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]")}>
        {fields.map(([f, parts]) => (
          <p key={f} className={cn("m-0", f === "title" && "font-bold", f === "description" && "text-r-muted")}><Highlighted parts={parts} /></p>
        ))}
      </div>
      {long && <button type="button" onClick={() => setMore(!more)} className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-sm font-bold text-r-action">{more ? t("show_less_text") : t("show_more_text")}</button>}
    </div>
  );
}

function PostCard({ row, current, busy, hasTerm, onDecide, onFocus }: {
  row: ReviewRow; current: boolean; busy: boolean; hasTerm: boolean;
  onDecide: (action: "include" | "exclude", tag?: string) => void; onFocus: () => void;
}) {
  const { t, tf, name } = useT();
  const { pub, cls } = row;
  const [tag, setTag] = React.useState("__keep__");
  const badge = cls?.manual_decision
    ? { key: (cls.manual_decision === "include" ? "r_included" : "r_excluded") as TKey, cls: cls.manual_decision === "include" ? "bg-r-accepted-soft text-r-accepted" : "bg-r-sunk text-r-muted" }
    : cls ? AUTO_BADGE[cls.auto_decision] : undefined;
  const plat = PLATFORM_LABEL[pub.platform] ?? pub.platform;
  const time = pub.published_at.match(/\d{2}:\d{2}/)?.[0] ?? pub.published_at;
  const video = pub.platform === "youtube" || /video|reel|short/i.test(pub.content_type);

  const btn = (action: "include" | "exclude") => {
    const pressed = cls?.manual_decision === action;
    const hint = !cls?.manual_decision && cls?.auto_decision === (action === "include" ? "match" : "no_match");
    return (
      <button type="button" aria-pressed={pressed} disabled={busy || !cls} onClick={() => onDecide(action, tag)}
        className={cn("flex min-h-11 flex-1 cursor-pointer items-center justify-between gap-2 rounded-[10px] border-[1.5px] px-3.5 text-[15px] font-bold disabled:cursor-not-allowed disabled:opacity-50",
          pressed && action === "include" && "border-r-accepted bg-r-accepted text-white",
          pressed && action === "exclude" && "border-r-ink bg-r-ink text-r-card",
          !pressed && "border-r-field bg-r-card text-r-ink hover:bg-r-sunk")}>
        <span className="flex items-center gap-2">
          {action === "include"
            ? <Check className={cn("size-4", hint && "text-r-accepted")} strokeWidth={2.6} aria-hidden />
            : <X className="size-4" strokeWidth={2.6} aria-hidden />}
          {t(action)}
        </span>
        <Kbd>{action === "include" ? "I" : "E"}</Kbd>
      </button>
    );
  };

  return (
    <li id={`rv${pub.id}`} onClick={onFocus}
      className={cn("rounded-[14px] border bg-r-card transition-shadow", current ? "border-2 border-r-focus shadow-[0_8px_24px_rgb(21_32_43/0.08)]" : "border-r-line", !row.counts && "opacity-75")}>
      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_200px]">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <PlatformBadge platform={pub.platform} className="size-[26px]" />
            <span className="text-[15px] font-bold">{pub.office ? name(pub.office) : t("not_mapped")}</span>
            <span className="text-xs text-r-muted">{pub.account.handle} · {time}</span>
            <span className="flex-1" />
            {badge && <span className={cn("rounded-full px-2 py-[3px] text-xs font-bold", badge.cls)}>{t(badge.key)}</span>}
          </div>
          <PostText row={row} />
          {cls?.auto_decision === "insufficient_text" && video && (
            <p className="m-0 mt-2 text-[13px] text-r-muted">{t("little_text_hint")} <a href={pub.url} target="_blank" rel="noopener">{tf("open_on", { p: plat })} ↗</a></p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
            <a href={pub.url} target="_blank" rel="noopener" className="font-bold text-r-action no-underline hover:text-r-action-hover">{tf("open_on", { p: plat })} ↗</a>
            <Link to={`/publications/${pub.id}`} className="inline-flex items-center gap-1 text-r-muted no-underline hover:text-r-ink"><Eye className="size-3.5" aria-hidden />{t("details_raw")}</Link>
            {pub.media_count > 0 && <span className="text-r-muted">{tf("media_only_text", { n: pub.media_count })}</span>}
            {!row.counts && <span className="text-r-muted">{tf("mon_not_counted", { r: row.count_reason })}</span>}
          </div>
        </div>
        {hasTerm && cls && (
          <div className="hidden flex-col gap-2 sm:flex lg:justify-start">
            <div className="flex gap-2 lg:flex-col">{btn("include")}{btn("exclude")}</div>
            {video && (
              <RSelect value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag" className="min-h-9 text-xs">
                <option value="__keep__">Tag: {cls.report_tag ? labelOf(cls.report_tag) : "—"}</option>
                <option value="">—</option>
                <option value="video_bite">{labelOf("video_bite")}</option>
                <option value="video_interview">{labelOf("video_interview")}</option>
              </RSelect>
            )}
            {cls.manual_note && <p className="m-0 text-xs text-r-muted italic">“{cls.manual_note}”</p>}
          </div>
        )}
      </div>
    </li>
  );
}

function DecidedRow({ row, action, busy, onUndo }: { row: ReviewRow; action: "include" | "exclude"; busy: boolean; onUndo: () => void }) {
  const { t, name } = useT();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-r-line-soft bg-r-ground/60 px-4 py-2.5">
      {action === "include" ? <Check className="size-4 text-r-accepted" strokeWidth={2.6} aria-hidden /> : <X className="size-4 text-r-muted" strokeWidth={2.6} aria-hidden />}
      <span className="text-sm font-bold">{row.pub.office ? name(row.pub.office) : row.pub.account.handle}</span>
      <span className="text-[13px] text-r-muted">{row.pub.account.handle} · {PLATFORM_LABEL[row.pub.platform] ?? row.pub.platform}</span>
      <span className="flex-1" />
      <span className="text-[13px] text-r-muted">{action === "include" ? t("decided_inc") : t("decided_exc")}</span>
      <RButton size="sm" variant="ghost" disabled={busy} onClick={onUndo}>{t("undo")}</RButton>
    </li>
  );
}
