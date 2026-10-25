import * as React from "react";
import { NavLink } from "react-router-dom";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, type Lang, type TKey } from "@/lib/i18n";
import { RTitle } from "@/components/reports/kit";
import { CURVE_HOURS, USUAL_SHAPE, type Bi, type Format, type Post } from "./sample";

/* Shared pieces of the Insights pages (Overview, Posts, One post, Districts). */

export const bi = (x: Bi, lang: Lang) => x[lang];

/** 42,60,000 → "42.6 L", 3,82,000 → "3.82 L", 86,000 → "86K", 6,200 → "6.2K". */
export function views(n: number) {
  if (n >= 1000000) return (n / 100000).toFixed(1) + " L";
  if (n >= 100000) return (n / 100000).toFixed(2) + " L";
  if (n >= 10000) return Math.round(n / 1000) + "K";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

export const mult = (m: number) => m.toFixed(1) + "×";

/** Green when a post clearly beat its account's usual, red when it clearly fell short. */
export function multTone(m: number) {
  return m >= 1.5 ? "good" : m >= 0.9 ? "plain" : "bad";
}
export const TONE_TEXT = { good: "text-r-accepted", plain: "text-r-ink", bad: "text-r-overdue" } as const;
export const TONE_BG = { good: "bg-r-accepted", plain: "bg-r-ink", bad: "bg-r-overdue" } as const;
export const TONE_STROKE = { good: "stroke-r-accepted", plain: "stroke-r-ink", bad: "stroke-r-overdue" } as const;

export const FORMAT_LABEL: Record<Format, TKey> = {
  short_video: "ins_fmt_short", long_video: "ins_fmt_long", poster: "ins_fmt_poster", text: "ins_fmt_text",
};

export function agoLabel(days: number, t: (k: TKey) => string, tf: (k: TKey, v: Record<string, number>) => string) {
  return days === 0 ? t("ins_today") : days === 1 ? t("ins_yesterday") : tf("ins_days_ago", { n: days });
}

/** Views (thousands) at each of CURVE_HOURS; posts without a recorded curve follow the usual shape times `mult`. */
export function postCurve(p: Post) {
  if (p.curve) return p.curve;
  const total = p.views / 1000;
  return USUAL_SHAPE.map((s) => s * total);
}
export const usualCurve = (p: Post) => USUAL_SHAPE.map((s) => (s * p.views) / 1000 / p.mult);
export { CURVE_HOURS };

/** "M x y L x y …" through evenly spaced points. */
export function linePath(values: number[], { w, h, max, padX = 0, padY = 0 }: { w: number; h: number; max: number; padX?: number; padY?: number }) {
  const step = (w - padX * 2) / Math.max(1, values.length - 1);
  return values.map((v, i) => `${i ? "L" : "M"}${(padX + i * step).toFixed(1)} ${(h - padY - (v / max) * (h - padY * 2)).toFixed(1)}`).join(" ");
}

/** The header of every Insights page: title, a line under it, and the sample-data label. */
export function InsightsTitle({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  const { t } = useT();
  return (
    <RTitle title={title} sub={sub} actions={<>
      {actions}
      <span className="rounded-full bg-r-returned-soft px-2.5 py-1 text-xs font-bold text-r-returned-ink" title={t("ins_sample_hint")}>{t("ins_sample")}</span>
    </>} />
  );
}

/** Overview · Posts · Districts, under the page title on small screens (the sidebar has them on large ones). */
export function InsightsTabs() {
  const { t } = useT();
  const tabs: { to: string; label: TKey; end?: boolean }[] = [
    { to: "/insights", label: "ins_overview", end: true }, { to: "/insights/posts", label: "ins_posts" }, { to: "/insights/districts", label: "ins_districts" },
  ];
  return (
    <nav aria-label={t("nav_analytics")} className="flex gap-1 overflow-x-auto lg:hidden">
      {tabs.map((x) => (
        <NavLink key={x.to} to={x.to} end={x.end}
          className={({ isActive }) => cn("shrink-0 rounded-full border-[1.5px] px-3.5 py-1.5 text-sm font-bold no-underline",
            isActive ? "border-r-ink bg-r-ink text-r-card" : "border-r-line bg-r-card text-r-ink")}>
          {t(x.label)}
        </NavLink>
      ))}
    </nav>
  );
}

/** The coloured stand-in for a post's picture or video frame. */
export function Thumb({ tint, video, className }: { tint: string; video?: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("flex shrink-0 items-center justify-center", className)} style={{ background: tint }}>
      {video && <span className="flex size-10 items-center justify-center rounded-full bg-[#15202b]/50"><Play className="size-4 fill-white text-white" /></span>}
    </span>
  );
}

export function Legend({ items }: { items: { label: React.ReactNode; swatch: React.ReactNode }[] }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-r-muted">
      {items.map((x, i) => <span key={i} className="flex items-center gap-2">{x.swatch}{x.label}</span>)}
    </div>
  );
}

export function SectionHead({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="disp m-0 text-[22px] font-bold">{title}</h2>
      {children}
    </div>
  );
}

export function Eyebrow({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("text-[13px] font-bold tracking-[0.06em] uppercase", className)} {...props} />;
}
