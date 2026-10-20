import * as React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Bell, Check, CheckCircle2, ChevronRight, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, type Lang, type TKey } from "@/lib/i18n";
import { PLATFORM_LABEL } from "@/lib/status";
import type { Account, Meta, RunDetail } from "@/lib/api";
import { RSheet } from "@/components/reports/kit";

/* Building blocks for the one-page Monitoring screen (collect → review → report). */

export type StepState = "todo" | "active" | "done";

const PLATFORM_BADGE: Record<string, { bg: string; glyph: string }> = {
  facebook: { bg: "bg-[#1877f2]", glyph: "f" },
  x: { bg: "bg-[#15202b] dark:bg-[#3a4652]", glyph: "X" },
  instagram: { bg: "bg-[#b1307a]", glyph: "IG" },
  youtube: { bg: "bg-[#c4170c]", glyph: "YT" },
};

export function PlatformBadge({ platform, className }: { platform: string; className?: string }) {
  const s = PLATFORM_BADGE[platform] ?? { bg: "bg-r-faint", glyph: platform.slice(0, 1).toUpperCase() };
  return (
    <span title={PLATFORM_LABEL[platform] ?? platform}
      className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] text-[13px] font-bold text-white", s.bg, className)}>
      {s.glyph}
    </span>
  );
}

/** "Mon, 19 Oct" in the viewer's language. */
export function dayLabel(iso: string, lang: Lang) {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === "mr" ? "mr-IN" : "en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export function rangeLabel(start: string, end: string, lang: Lang) {
  if (start === end) return dayLabel(start, lang);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const loc = lang === "mr" ? "mr-IN" : "en-IN";
  return `${new Date(start + "T00:00:00").toLocaleDateString(loc, opts)} – ${new Date(end + "T00:00:00").toLocaleDateString(loc, opts)}`;
}

/** "2026-10-19 11:42 IST" → Date. */
export function parseIst(s: string | null | undefined) {
  const m = s?.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
  return m ? new Date(`${m[1]}T${m[2]}:00+05:30`) : null;
}

export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const TASK_DONE = ["complete", "partial", "failed", "skipped"];
export const runLive = (r: RunDetail) => r.active || ["queued", "running"].includes(r.status);

/** One step on the page: the numbered rail on the left, the card on the right. */
export function StepFrame({ n, state, busy, last, labelledBy, children }: {
  n: number; state: StepState; busy?: boolean; last?: boolean; labelledBy: string; children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={labelledBy} className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-3 sm:grid-cols-[40px_minmax(0,1fr)] sm:gap-x-4">
      <div className="flex flex-col items-center">
        <div className={cn("disp flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-[15px] font-bold sm:size-10 sm:text-[17px]",
          state === "done" && "border-r-accepted bg-r-accepted text-white",
          state === "active" && "border-r-focus bg-r-today",
          state === "todo" && "border-r-field bg-r-ground text-r-muted")}>
          {state === "done" ? <Check className="size-5" strokeWidth={3} aria-hidden />
            : busy ? <Loader2 className="size-[18px] animate-spin" strokeWidth={2.6} aria-hidden /> : n}
        </div>
        {!last && <div className={cn("mt-2 w-0.5 flex-1", state === "done" ? "bg-r-accepted/50" : "bg-r-line")} />}
      </div>
      <div className={cn("min-w-0", !last && "mb-6")}>{children}</div>
    </section>
  );
}

/** The highlighted card of the current step. */
export function ActiveCard({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("overflow-hidden rounded-2xl border border-r-focus bg-r-card shadow-[0_0_0_4px_rgb(242_181_68/0.18),0_8px_24px_rgb(21_32_43/0.06)]", className)} {...props} />;
}

/** A step that hasn't opened yet. */
export function PendingCard({ eyebrow, title, id, children, aside, solid }: {
  eyebrow: React.ReactNode; title: React.ReactNode; id: string; children?: React.ReactNode; aside?: React.ReactNode; solid?: boolean;
}) {
  return (
    <div className={cn("rounded-2xl px-5 py-5 sm:px-6", solid ? "border border-r-line bg-r-card" : "border border-dashed border-r-field")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-[1_1_320px]">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 id={id} className={cn("disp m-0 mt-1 text-xl font-bold", !solid && "text-r-muted")}>{title}</h2>
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function Eyebrow({ className, tone, ...props }: React.ComponentProps<"div"> & { tone?: "focus" }) {
  return <div className={cn("text-xs font-bold tracking-[0.08em] uppercase", tone === "focus" ? "text-r-returned-ink" : "text-r-muted", className)} {...props} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="num rounded-[5px] border border-r-field border-b-2 bg-r-card px-1.5 text-[11px] font-semibold text-r-ink">{children}</kbd>;
}

/** The three-step progress pills under the page title. */
export function Stepper({ states, collectNote, reviewNote }: {
  states: [StepState, StepState, StepState]; collectNote?: React.ReactNode; reviewNote?: React.ReactNode;
}) {
  const { t } = useT();
  const labels: TKey[] = ["step_collect", "step_review", "step_report"];
  const notes = [collectNote, reviewNote, null];
  return (
    <ol aria-label={t("mon_progress")} className="m-0 flex list-none flex-wrap gap-1.5 p-0 text-[13px] font-bold">
      {states.map((s, i) => (
        <li key={i} aria-current={s === "active" ? "step" : undefined}
          className={cn("flex items-center gap-2 rounded-full py-1.5 pr-3 pl-1.5",
            s === "active" && "border border-r-focus bg-r-today",
            s === "done" && "bg-r-accepted-soft text-r-accepted",
            s === "todo" && "bg-r-sunk text-r-muted")}>
          <span className={cn("flex size-[22px] items-center justify-center rounded-full text-xs",
            s === "active" && "bg-r-focus text-[#15202b]",
            s === "done" && "bg-r-accepted text-white",
            s === "todo" && "border border-r-field bg-r-card")}>
            {s === "done" ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : i + 1}
          </span>
          {t(labels[i])}
          {notes[i] && <span className="num font-medium">{notes[i]}</span>}
        </li>
      ))}
    </ol>
  );
}

// --------------------------------------------------------------------------- needs attention
type Item = { tone: "danger" | "warning" | "info"; title: string; body: React.ReactNode; to?: string; onClick?: () => void };

/** The bell beside the page title: failed accounts, unconfirmed office mappings, provider problems. */
export function MonitorBell({ run, accounts, meta, start, end }: {
  run?: RunDetail | null; accounts?: Account[]; meta?: Meta; start: string; end: string;
}) {
  const { t, tf, lang } = useT();
  const [open, setOpen] = React.useState(false);
  const close = () => setOpen(false);

  const items: Item[] = [];
  for (const task of run?.tasks ?? []) {
    if (task.status === "failed" || (TASK_DONE.includes(task.status) && task.window_complete === false)) {
      items.push({ tone: "danger", title: tf("bell_failed_t", { h: task.handle, p: PLATFORM_LABEL[task.platform] ?? task.platform }),
        body: <>{task.error ? `${task.error} · ` : ""}{t("bell_failed_b")}</> });
    }
  }
  const missing = meta?.providers?.filter((p) => p.credentials === "MISSING") ?? [];
  if (missing.length) items.push({ tone: "danger", title: t("bell_creds_t"),
    body: tf("bell_creds_b", { p: missing.map((p) => PLATFORM_LABEL[p.platform] ?? p.platform).join(", ") }) });
  const unconf = accounts?.filter((a) => !a.mapping_confirmed) ?? [];
  if (unconf.length) items.push({ tone: "warning", title: tf("bell_unconf_t", { n: unconf.length }), to: "/accounts",
    body: <><span className="block">{unconf.slice(0, 6).map((a) => a.handle).join(" · ")}{unconf.length > 6 ? " …" : ""}</span>{t("bell_unconf_b")}</> });
  const fixtures = meta?.providers?.filter((p) => p.provider.startsWith("fixture")) ?? [];
  if (fixtures.length) items.push({ tone: "warning", title: t("bell_sample_t"),
    body: tf("bell_sample_b", { p: fixtures.map((p) => PLATFORM_LABEL[p.platform] ?? p.platform).join(", ") }) });

  const info: Item[] = [];
  if (meta?.covered_day && start === meta.covered_day && end === meta.covered_day && !run)
    info.push({ tone: "info", title: tf("bell_covered_t", { day: dayLabel(meta.covered_day, lang) }), body: t("bell_covered_b") });

  const n = items.length;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`${t("needs_attention")}${n ? ` · ${n}` : ""}`} title={t("needs_attention")}
        className="relative flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] border border-r-line bg-r-card text-r-ink hover:bg-r-sunk">
        <Bell className="size-5" aria-hidden />
        {n > 0 && <span className="num absolute -top-1.5 -right-1.5 min-w-5 rounded-full bg-r-overdue px-1.5 text-center text-[11px] leading-5 font-bold text-white">{n}</span>}
      </button>
      <RSheet open={open} onClose={close} closeLabel={t("close")} title={t("needs_attention")}
        description={`${t("nav_social")} · ${rangeLabel(start, end, lang)}`}
        footer={<span className="text-[13px] text-r-muted">{t("bell_footer")}</span>}>
        <div className="flex flex-col gap-2.5">
          {!n && (
            <div className="flex items-center gap-3 rounded-[14px] bg-r-card p-4">
              <CheckCircle2 className="size-6 shrink-0 text-r-accepted" aria-hidden /><b>{t("caught_up")}</b>
            </div>
          )}
          {items.map((it, i) => <AttentionRow key={i} item={it} onNavigate={close} />)}
          {info.length > 0 && <Eyebrow className="mt-2.5">{t("good_to_know")}</Eyebrow>}
          {info.map((it, i) => <AttentionRow key={`i${i}`} item={it} onNavigate={close} />)}
        </div>
      </RSheet>
    </>
  );
}

function AttentionRow({ item, onNavigate }: { item: Item; onNavigate: () => void }) {
  const Icon = item.tone === "danger" ? X : item.tone === "warning" ? AlertTriangle : Check;
  const inner = (
    <>
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full",
        item.tone === "danger" && "bg-r-overdue-soft text-r-overdue",
        item.tone === "warning" && "bg-r-card text-r-returned",
        item.tone === "info" && "bg-r-accepted-soft text-r-accepted")}>
        <Icon className="size-[15px]" strokeWidth={2.6} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <b className="text-[15px]">{item.title}</b>
        <span className={cn("text-sm leading-[1.45]", item.tone === "warning" ? "text-r-returned-ink" : "text-r-muted")}>{item.body}</span>
      </span>
      {item.to && <ChevronRight className="mt-1 size-5 shrink-0 text-r-muted" aria-hidden />}
    </>
  );
  const cls = cn("flex gap-3.5 rounded-[14px] p-4 text-r-ink no-underline",
    item.tone === "danger" && "border-[1.5px] border-r-overdue bg-r-card",
    item.tone === "warning" && "border-[1.5px] border-r-returned bg-r-returned-soft",
    item.tone === "info" && "border border-r-line bg-r-card");
  return item.to ? <Link to={item.to} onClick={onNavigate} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>;
}
