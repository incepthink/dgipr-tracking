import * as React from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Check, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, type TKey } from "@/lib/i18n";
import { PLATFORM_LABEL } from "@/lib/status";
import { RCard, RPage, RSegmented } from "@/components/reports/kit";
import { POSTS, type Post, type Talk, type TalkKind } from "./sample";
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisNum, bi, chartChrome, ChartTip, CURVE_HOURS, DashedKey, FORMAT_LABEL, fullNum, Legend, mult, postCurve, SectionHead, SolidKey, Thumb, usualCurve, views } from "./kit";

const TIME_TICKS = [0, 6, 24, 48, 72, 120, 168];

/** One post: how it compares with its account's usual post, how its views grew, every platform, and what people said. */
export default function InsightsPost() {
  const { id } = useParams();
  const { t, tf, lang } = useT();
  const p = POSTS.find((x) => x.id === id);
  if (!p) return <Navigate to="/insights/posts" replace />;

  const office = lang === "en" ? p.office.name_en : p.office.name_mr;
  const rank = POSTS.slice().sort((a, b) => b.mult - a.mult).indexOf(p);
  const verdict = p.mult >= 1 ? tf("ins_better_than_office", { office }) : tf("ins_worse_than_office", { office });

  return (
    <RPage className="gap-6">
      <Link to="/insights/posts" className="flex items-center gap-1 self-start font-bold text-r-action no-underline"><ChevronLeft className="size-4" aria-hidden />{t("ins_all_posts")}</Link>

      <section className="flex flex-wrap gap-5">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col overflow-hidden rounded-[18px] bg-r-card">
          <Thumb tint={p.tint} src={p.image} video={p.format.endsWith("video")} className="h-[220px]" />
          <div className="flex flex-col gap-1.5 px-5 pt-[18px] pb-5">
            <span className="text-sm text-r-muted">{office} · {PLATFORM_LABEL[p.platform]} · {t(FORMAT_LABEL[p.format])} · {bi(p.posted, lang)}</span>
            <h1 lang="mr" className="m-0 text-[19px] leading-snug font-semibold">{p.caption}</h1>
          </div>
        </div>
        <div className="flex min-w-0 flex-[1.3_1_380px] flex-col gap-4">
          <div className="flex flex-1 flex-col justify-center gap-1.5 rounded-[18px] bg-r-hero px-7 py-7 text-white">
            <span className={cn("num text-[64px] leading-none font-semibold tracking-[-0.04em] sm:text-[80px]", p.mult >= 1 ? "text-r-focus" : "text-[#f6a39a]")}>{mult(p.mult)}</span>
            <span className="text-xl font-bold">{verdict}</span>
            {rank === 0 && <span className="text-r-nav-text">{t("ins_best_in_state")}</span>}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[[t("ins_views"), views(p.views)], [t("ins_reactions"), views(Math.round(p.views * 0.048))], [t("ins_shares"), views(Math.round(p.views * 0.0081))]].map(([k, v]) => (
              <div key={k} className="rounded-[14px] bg-r-card px-[18px] py-4">
                <span className="text-sm text-r-muted">{k}</span>
                <div className="num text-[22px] font-semibold sm:text-[26px]">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Growth p={p} />

      {p.platforms && (
        <RCard className="gap-4 px-7 py-6">
          <SectionHead title={t("ins_every_platform")}>
            <span className="text-r-muted">{t("ins_together")}: <b className="num text-r-ink">{views(p.platforms.reduce((s, x) => s + x.views, 0))}</b></span>
          </SectionHead>
          {p.platforms.map((x, i) => (
            <div key={x.platform} className="grid grid-cols-[96px_minmax(0,1fr)_72px] items-center gap-4">
              <span className="font-bold">{PLATFORM_LABEL[x.platform]}</span>
              <span className="h-[26px] overflow-hidden rounded-lg bg-r-line-soft">
                <span className={cn("block h-full rounded-lg", ["bg-r-seq-5", "bg-r-seq-4", "bg-r-seq-3", "bg-r-seq-2"][i] ?? "bg-r-seq-2")}
                  style={{ width: `${(x.views / p.platforms![0].views) * 100}%` }} />
              </span>
              <span className="num text-right text-[17px] font-semibold">{views(x.views)}</span>
            </div>
          ))}
          {p.platformsNote && <span className="text-sm text-r-muted">{bi(p.platformsNote, lang)}</span>}
        </RCard>
      )}

      {p.why && (
        <section className="flex flex-col gap-3.5 rounded-[18px] bg-r-today px-7 py-6">
          <h2 className="disp m-0 text-[22px] font-bold">{p.mult >= 1 ? t("ins_why_worked") : t("ins_why_not")}</h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-x-6 gap-y-3.5">
            {p.why.map((w, i) => (
              <div key={i} className="flex items-start gap-3.5">
                <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-r-hero text-sm font-bold text-r-focus">{i + 1}</span>
                <div className="flex flex-col"><span className="font-bold">{bi(w.t, lang)}</span><span className="text-sm text-r-muted">{bi(w.b, lang)}</span></div>
              </div>
            ))}
          </div>
        </section>
      )}

      <PeopleSaid talk={p.talk} />
    </RPage>
  );
}

type Show = "all" | Exclude<TalkKind, "other">;
const KIND_LABEL: Record<TalkKind, TKey> = { question: "ins_kind_question", complaint: "ins_kind_complaint", praise: "ins_kind_praise", other: "ins_kind_other" };
const KIND_PILL: Record<TalkKind, string> = {
  question: "bg-r-action-soft text-r-action", complaint: "bg-r-overdue-soft text-r-overdue-ink",
  praise: "bg-r-accepted-soft text-r-accepted", other: "bg-r-sunk text-r-muted",
};
const KIND_BAR: Record<TalkKind, string> = { question: "bg-r-action", complaint: "bg-r-overdue", praise: "bg-r-accepted", other: "bg-r-field" };

/** The comments: overall mood, what still needs an answer, then one row per topic people raised. */
function PeopleSaid({ talk }: { talk: Talk }) {
  const { t, tf, lang } = useT();
  const [show, setShow] = React.useState<Show>("all");
  const sum = (xs: Talk["topics"]) => xs.reduce((s, x) => s + x.n, 0);
  const asked = sum(talk.topics.filter((x) => x.kind === "question"));
  const waiting = sum(talk.topics.filter((x) => (x.kind === "question" || x.kind === "complaint") && !x.replied));
  const rest = talk.total - sum(talk.topics);
  const top = Math.max(...talk.topics.map((x) => x.n));
  const rows = talk.topics.filter((x) => show === "all" || x.kind === show).sort((a, b) => b.n - a.n);
  const mood = [
    { label: t("ins_positive"), v: talk.pos, bg: "bg-r-accepted" },
    { label: t("ins_neutral"), v: talk.neu, bg: "bg-r-field" },
    { label: t("ins_negative"), v: talk.neg, bg: "bg-r-overdue" },
  ];

  return (
    <RCard className="gap-5 px-7 py-6">
      <SectionHead title={t("ins_people_said")}>
        <span className="text-r-muted">{tf("ins_n_comments", { n: fullNum(talk.total) })}</span>
      </SectionHead>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3">
        <div className="flex flex-col gap-2.5 rounded-[14px] bg-r-ground px-[18px] py-4 sm:col-span-2">
          <span className="text-sm text-r-muted">{t("ins_positive")}</span>
          <span className="num text-[26px] leading-none font-semibold text-r-accepted">{talk.pos}%</span>
          <div role="img" aria-label={mood.map((m) => `${m.v}% ${m.label}`).join(", ")} className="flex h-3 gap-[3px] overflow-hidden rounded-full">
            {mood.map((m) => m.v > 0 && <span key={m.label} className={m.bg} style={{ width: `${m.v}%` }} />)}
          </div>
          <Legend items={mood.map((m) => ({ label: <>{m.label} <b className="num text-r-ink">{m.v}%</b></>, swatch: <span className={cn("size-2.5 rounded-full", m.bg)} /> }))} />
        </div>
        <div className="flex flex-col gap-1 rounded-[14px] bg-r-ground px-[18px] py-4">
          <span className="text-sm text-r-muted">{t("ins_questions_asked")}</span>
          <span className="num text-[26px] font-semibold">{fullNum(asked)}</span>
        </div>
        <div className={cn("flex flex-col gap-1 rounded-[14px] px-[18px] py-4", waiting ? "bg-r-overdue-soft" : "bg-r-ground")}>
          <span className="text-sm text-r-muted">{t("ins_awaiting_reply")}</span>
          <span className={cn("num text-[26px] font-semibold", waiting ? "text-r-overdue-ink" : "text-r-ink")}>{fullNum(waiting)}</span>
          <span className="text-[13px] text-r-muted">{t("ins_awaiting_sub")}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="m-0 text-[17px] font-bold">{t("ins_talk_topics")}</h3>
        <RSegmented label={t("ins_talk_show")} value={show} onChange={setShow} options={[
          { value: "all", label: t("ins_talk_all") }, { value: "question", label: t("ins_talk_questions") },
          { value: "complaint", label: t("ins_talk_complaints") }, { value: "praise", label: t("ins_talk_praise") },
        ]} />
      </div>

      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((x) => (
          <li key={x.label.en} className="grid gap-x-8 gap-y-2.5 border-b border-r-line-soft py-4 first:pt-0 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className={cn("rounded-md px-2 py-0.5 text-[13px] font-bold", KIND_PILL[x.kind])}>{t(KIND_LABEL[x.kind])}</span>
                <span className="font-bold">{bi(x.label, lang)}</span>
                {x.replied !== undefined && (x.replied
                  ? <span className="flex items-center gap-1 text-sm text-r-muted"><Check className="size-3.5" aria-hidden />{t("ins_replied")}</span>
                  : <span className="text-sm font-bold text-r-overdue-ink">{t("ins_no_reply")}</span>)}
              </span>
              <span lang="mr" className="text-[17px]">“{x.quote.mr}”</span>
              {lang === "en" && <span className="text-sm text-r-muted">{x.quote.en}</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="flex items-baseline justify-between gap-2">
                <b className="num text-[17px]">{fullNum(x.n)}</b>
                <span className="text-sm text-r-muted">{tf("ins_of_comments", { p: Math.round((x.n / talk.total) * 100) })}</span>
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-r-line-soft">
                <span className={cn("block h-full rounded-full", KIND_BAR[x.kind])} style={{ width: `${(x.n / top) * 100}%` }} />
              </span>
            </div>
          </li>
        ))}
        {!rows.length && <li className="py-6 text-center text-r-muted">{t("ins_no_talk")}</li>}
      </ul>
      {rest > 0 && show === "all" && <span className="text-sm text-r-muted">{tf("ins_talk_rest", { n: fullNum(rest) })}</span>}
    </RCard>
  );
}

/** Views since posting against the account's usual post, on a square-root time axis so the first hours are readable. */
function Growth({ p }: { p: Post }) {
  const { t, tf, lang } = useT();
  // a post younger than a week only has the hours it has lived
  const ageH = p.curve ? 168 : Math.max(5, p.daysAgo * 24);
  const hours = CURVE_HOURS.filter((h) => h <= ageH);
  if (hours.at(-1)! < ageH) hours.push(ageH);
  const full = postCurve(p);
  const at = (vals: number[], h: number) => {
    const i = CURVE_HOURS.findIndex((x) => x >= h);
    if (CURVE_HOURS[i] === h) return vals[i];
    const [h0, h1] = [CURVE_HOURS[i - 1], CURVE_HOURS[i]];
    return vals[i - 1] + ((vals[i] - vals[i - 1]) * (h - h0)) / (h1 - h0);
  };
  // scale so the curve ends at the views the post has today
  const scale = p.curve ? 1 : p.views / 1000 / at(full, ageH);
  const actual = hours.map((h) => at(full, h) * scale);
  const usualFull = usualCurve(p);
  // one row per hour either line has a point at, in plain views
  const data = [...new Set([...CURVE_HOURS, ageH])].sort((a, b) => a - b).map((h) => ({
    h, usual: at(usualFull, h) * 1000, actual: h <= ageH ? at(full, h) * scale * 1000 : undefined,
  }));
  const endV = actual.at(-1)! * 1000;
  const usual7 = usualFull.at(-1)! * 1000;
  const ev = p.event && p.event.hour <= ageH ? p.event : undefined;
  const evV = ev ? at(full, ev.hour) * scale * 1000 : 0;
  const label = tf("ins_growth_label", { v: views(endV), u: views(usual7) });
  const c = chartChrome();
  const time = (h: number) => h === 0 ? t("ins_posted") : h === 24 ? t("ins_1_day") : h % 24 === 0 ? tf("ins_n_days", { n: h / 24 }) : tf("ins_n_h", { n: h });

  return (
    <RCard className="gap-3.5 px-7 py-6">
      <SectionHead title={t("ins_how_grew")}>
        <Legend items={[
          { label: t("ins_this_post"), swatch: <span className="h-1 w-[18px] rounded-sm bg-r-returned" /> },
          { label: t("ins_usual_post"), swatch: <span className="w-[18px] border-t-2 border-dashed border-r-seq-4" /> },
        ]} />
      </SectionHead>
      <div role="img" aria-label={label} className="h-[280px] w-full">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 24, right: 36, bottom: 0, left: 0 }}>
            <CartesianGrid {...c.grid} />
            {/* square-root time so the first hours are readable */}
            <XAxis dataKey="h" type="number" scale="sqrt" domain={[0, 168]} ticks={TIME_TICKS} {...c.xAxis} tickFormatter={time} />
            <YAxis {...c.axis} width={48} domain={[0, "auto"]} tickFormatter={axisNum} />
            <Tooltip cursor={c.cursor} isAnimationActive={false} content={({ active, payload }) => {
              const r = active && payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!r) return null;
              return <ChartTip title={r.h === 0 ? t("ins_posted") : tf("ins_after_posting", { t: time(r.h) })}
                foot={r.actual && r.usual ? tf("ins_vs_usual_post", { m: mult(r.actual / r.usual) }) : undefined}
                rows={[
                  ...(r.actual !== undefined ? [{ key: <SolidKey className="bg-r-returned" />, value: fullNum(r.actual), label: t("ins_this_post") }] : []),
                  { key: <DashedKey className="border-r-seq-4" />, value: fullNum(r.usual), label: t("ins_usual_post") },
                ]} />;
            }} />
            <Line dataKey="usual" stroke="var(--r-seq-4)" strokeWidth={2.5} strokeDasharray="7 6" dot={false}
              activeDot={{ r: 4, fill: "var(--r-seq-4)", stroke: "var(--r-card)", strokeWidth: 2 }} isAnimationActive={false}
              label={(l: { index?: number; x?: number | string; y?: number | string }) => l.index === data.length - 1
                ? <text x={Number(l.x)} y={Number(l.y) - 10} textAnchor="end" fontSize={13} className="num fill-r-action">{views(usual7)}</text> : <g />} />
            <Line dataKey="actual" stroke="var(--r-returned)" strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round" connectNulls={false}
              dot={{ r: 3, fill: "var(--r-returned)", stroke: "var(--r-card)", strokeWidth: 2 }}
              activeDot={{ r: 6, fill: "var(--r-returned)", stroke: "var(--r-card)", strokeWidth: 2 }} isAnimationActive={false}
              label={(l: { index?: number; x?: number | string; y?: number | string }) => data[l.index ?? -1]?.h === ageH
                ? <text x={Number(l.x)} y={Number(l.y) - 12} textAnchor="end" fontSize={15} fontWeight={600} className="num fill-r-ink">{views(endV)}</text> : <g />} />
            {ev && <ReferenceDot x={ev.hour} y={evV} r={6} fill="var(--r-ink)" stroke="var(--r-card)" strokeWidth={2}
              label={{ value: bi(ev.label, lang), position: "right", offset: 12, fontSize: 14, fontWeight: 700, fill: "var(--r-ink)" }} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {!p.curve && p.daysAgo < 7 && <span className="text-sm text-r-muted">{t("ins_still_live")}</span>}
    </RCard>
  );
}
