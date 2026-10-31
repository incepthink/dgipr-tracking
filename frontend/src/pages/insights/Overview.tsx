import { Link } from "react-router-dom";
import { TrendingUp, ArrowRight } from "lucide-react";
import { cn, dmy } from "@/lib/utils";
import { PLATFORM_LABEL } from "@/lib/status";
import { useT } from "@/lib/i18n";
import { RCard, RPage } from "@/components/reports/kit";
import { rangeLabel } from "@/pages/monitor/shared";
import { CAMPAIGN, OVERVIEW, POSTS, WEEK } from "./sample";
import { Area, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisNum, bi, chartChrome, ChartTip, DashedKey, Eyebrow, fullNum, InsightsTabs, InsightsTitle, mult, pctChange, SectionHead, SolidKey, Thumb, views } from "./kit";

/** Insights home: what is rising now, this week's views against last week, the change since tracking began,
 *  three numbers, the best posts, what citizens are asking, and what needs attention. */
export default function InsightsOverview() {
  const { t, tf, lang } = useT();
  const o = OVERVIEW;
  const rising = POSTS.find((p) => p.id === o.rising.postId)!;
  const best = POSTS.slice().sort((a, b) => b.mult - a.mult).slice(0, 3);

  return (
    <RPage className="gap-7">
      <InsightsTitle title={t("ins_this_week")} sub={`${bi(CAMPAIGN, lang)} · ${rangeLabel(WEEK.start, WEEK.end, lang)}`} />
      <InsightsTabs />

      <section aria-label={t("ins_rising")} className="flex flex-wrap items-center gap-4 rounded-2xl border-2 border-r-focus bg-r-card px-5 py-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-r-focus text-[#15202b]"><TrendingUp className="size-[22px]" strokeWidth={2.4} aria-hidden /></span>
        <div className="flex min-w-0 flex-[1_1_320px] flex-col">
          <Eyebrow className="text-r-returned-ink">{t("ins_rising")}</Eyebrow>
          <span>
            <b lang="mr">“{rising.caption}”</b>{" "}
            {tf("ins_rising_body", { office: lang === "en" ? rising.office.name_en : rising.office.name_mr, v: views(o.rising.views), h: o.rising.hours })}{" "}
            <b>{tf("ins_x_usual", { m: mult(o.rising.mult) })}</b>
          </span>
        </div>
        <Link to={`/insights/posts/${rising.id}`} className="rounded-[10px] bg-r-focus px-4 py-2.5 font-bold text-[#15202b] no-underline hover:brightness-95">{t("ins_open_post")}</Link>
      </section>

      <WeekViews />
      <SinceTracking />

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-4">
        {o.kpis.map((k) => (
          <div key={k.label.en} className="flex flex-col gap-1 rounded-2xl bg-r-card px-6 py-5">
            <span className="text-r-muted">{bi(k.label, lang)}</span>
            <span className="num text-[34px] font-semibold tracking-[-0.02em]">{k.value}</span>
            <span className={cn("text-sm font-bold", k.good ? "text-r-accepted" : "text-r-overdue")}>{bi(k.delta, lang)}</span>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHead title={t("ins_best_posts")}><Link to="/insights/posts" className="font-bold text-r-action">{t("ins_see_all_posts")}</Link></SectionHead>
        <Podium posts={best} />
      </section>

      <Asking />

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-4">
        <RCard className="gap-3.5 px-6 py-5">
          <h2 className="disp m-0 text-[22px] font-bold">{t("ins_attention")}</h2>
          {o.alerts.map((a) => (
            <div key={a.title.en} className="flex items-start gap-3">
              <span aria-hidden className={cn("mt-2 size-2.5 shrink-0 rounded-full", a.level === "bad" ? "bg-r-overdue" : "bg-r-returned")} />
              <div className="flex flex-col"><span className="font-bold">{bi(a.title, lang)}</span><span className="text-sm text-r-muted">{bi(a.body, lang)}</span></div>
            </div>
          ))}
          <Link to="/insights/districts" className="flex items-center gap-1.5 self-start text-sm font-bold text-r-action">{t("ins_see_districts")} <ArrowRight className="size-4" aria-hidden /></Link>
        </RCard>
        <div className="flex flex-col gap-2.5 rounded-2xl bg-r-today px-6 py-5">
          <Eyebrow className="text-r-returned-ink">{t("ins_tip")}</Eyebrow>
          <span className="disp text-2xl leading-tight font-bold">{bi(o.tip.title, lang)}</span>
          <span className="text-r-muted">{bi(o.tip.body, lang)}</span>
        </div>
      </section>
    </RPage>
  );
}

/* Medal colours stay the same in both themes: they sit on their own gradient, with their own dark ink. */
const MEDALS = [
  { label: "ins_medal_gold", ink: "#4a3200", grad: "linear-gradient(135deg,#fde89a 0%,#e0a526 55%,#b47a0c 100%)", thumb: "h-48", step: "h-16", glow: "shadow-[0_14px_32px_-14px_rgba(224,165,38,0.75)]" },
  { label: "ins_medal_silver", ink: "#262d35", grad: "linear-gradient(135deg,#f4f6f8 0%,#b9c1ca 55%,#86909c 100%)", thumb: "h-36", step: "h-11", glow: "" },
  { label: "ins_medal_bronze", ink: "#3d200a", grad: "linear-gradient(135deg,#f3c9a0 0%,#c47f45 55%,#8c5124 100%)", thumb: "h-36", step: "h-8", glow: "" },
] as const;

/** This week's top three posts, gold · silver · bronze left to right, each card standing on its step. */
function Podium({ posts }: { posts: typeof POSTS }) {
  const { t, tf, lang } = useT();
  return (
    <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-3 sm:items-end">
      {posts.map((p, k) => {
        const m = MEDALS[k];
        return (
          <li key={p.id} className="flex min-w-0 flex-col">
            <Link to={`/insights/posts/${p.id}`}
              className={cn("flex flex-col overflow-hidden rounded-2xl bg-r-card text-r-ink no-underline hover:ring-2 hover:ring-r-line sm:rounded-b-none", m.glow)}>
              <span className="sr-only">{k + 1} · {t(m.label)}</span>
              <Thumb tint={p.tint} src={p.image} video={p.format.endsWith("video")} className={m.thumb} />
              <div className="flex flex-col gap-2 px-[18px] pt-4 pb-[18px]">
                <span className="text-sm text-r-muted">{lang === "en" ? p.office.name_en : p.office.name_mr} · {PLATFORM_LABEL[p.platform]}</span>
                <span lang="mr" className={cn("leading-snug font-semibold", k === 0 ? "text-[19px]" : "text-[17px]")}>{p.caption}</span>
                <span className="text-[15px]"><b className="num text-r-accepted">{mult(p.mult)}</b> {t("ins_better_than_usual")} · {tf("ins_n_views", { v: views(p.views) })}</span>
              </div>
            </Link>
            <span aria-hidden className={cn("hidden items-center justify-center rounded-b-2xl sm:flex", m.step)} style={{ background: m.grad, color: m.ink }}>
              <span className="num text-2xl font-bold opacity-80">{k + 1}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The one big number, with this week's views per day against last week's. */
function WeekViews() {
  const { t, tf, lang } = useT();
  const o = OVERVIEW;
  const loc = lang === "mr" ? "mr-IN" : "en-IN";
  // views per day are stored in lakh; the chart works in plain views
  const data = o.thisWeek.map((v, i) => {
    const d = new Date(WEEK.start + "T00:00:00");
    d.setDate(d.getDate() + i);
    return {
      day: d.toLocaleDateString(loc, { weekday: "short" }),
      date: `${d.toLocaleDateString(loc, { weekday: "long" })}, ${dmy(d)}`,
      thisWeek: v * 100000, lastWeek: o.lastWeek[i] * 100000,
    };
  });
  const c = chartChrome(true);
  const label = lang === "en"
    ? `Views per day: this week went from ${o.thisWeek[0]} to ${o.thisWeek.at(-1)} lakh, above last week every day.`
    : `दररोजचे व्ह्यूज: या आठवड्यात ${o.thisWeek[0]} ते ${o.thisWeek.at(-1)} लाख, प्रत्येक दिवशी मागील आठवड्यापेक्षा जास्त.`;
  return (
    <section className="flex flex-wrap items-center gap-8 rounded-[20px] bg-r-hero px-8 py-8 text-white">
      <div className="flex flex-[1_1_300px] flex-col gap-2.5">
        <span className="text-[15px] text-r-nav-text">{t("ins_campaign_views")}</span>
        <span className="num text-[56px] leading-none font-semibold tracking-[-0.03em] sm:text-[72px]">{views(o.views)}</span>
        <span className="text-lg"><b className="text-r-focus">▲ {o.viewsDelta}%</b> {t("ins_more_than_last_week")}</span>
      </div>
      <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-2">
        <span aria-hidden className="text-sm font-medium text-r-nav-text">{t("ins_views_per_day")}</span>
        <div role="img" aria-label={label} className="h-[190px] w-full">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid {...c.grid} />
              <XAxis dataKey="day" {...c.xAxis} padding={{ left: 12, right: 12 }} />
              <YAxis {...c.axis} width={44} domain={[0, "auto"]} tickFormatter={axisNum} />
              <Tooltip cursor={c.cursor} isAnimationActive={false} content={({ active, payload }) => {
                const r = active && payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!r) return null;
                return <ChartTip title={r.date} foot={tf("ins_vs_last_week", { p: pctChange(r.thisWeek, r.lastWeek) })} rows={[
                  { key: <SolidKey className="bg-r-focus" />, value: fullNum(r.thisWeek), label: t("ins_this_week") },
                  { key: <DashedKey className="border-[#7d878f]" />, value: fullNum(r.lastWeek), label: t("ins_last_week") },
                ]} />;
              }} />
              <Line dataKey="lastWeek" stroke="#7d878f" strokeWidth={2} strokeDasharray="5 5" dot={false}
                activeDot={{ r: 4, fill: "#7d878f", stroke: "var(--r-hero)", strokeWidth: 2 }} isAnimationActive={false} />
              <Line dataKey="thisWeek" stroke="#f2b544" strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round"
                dot={{ r: 3, fill: "#f2b544", stroke: "var(--r-hero)", strokeWidth: 2 }}
                activeDot={{ r: 6, fill: "#f2b544", stroke: "var(--r-hero)", strokeWidth: 2 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-5 text-sm text-r-nav-text">
          <span className="flex items-center gap-2"><span className="h-1 w-[18px] rounded-sm bg-r-focus" />{t("ins_this_week")}</span>
          <span className="flex items-center gap-2"><span className="w-[18px] border-t-2 border-dashed border-[#7d878f]" />{t("ins_last_week")}</span>
        </div>
      </div>
    </section>
  );
}

/** Questions from comments on our posts, most asked first, with a bar against the top one. */
function Asking() {
  const { t, lang } = useT();
  const rows = OVERVIEW.questions.slice().sort((a, b) => b.n - a.n);
  const max = rows[0]?.n ?? 1;
  const th = "border-b border-r-line px-2 py-2 text-[13px] font-bold text-r-muted";
  return (
    <RCard className="gap-3 px-6 py-5">
      <SectionHead title={t("ins_asking")}><span className="text-sm text-r-muted">{t("ins_asking_hint")}</span></SectionHead>
      <table className="w-full border-separate border-spacing-0" aria-label={t("ins_asking")}>
        <thead>
          <tr>
            <th scope="col" className={cn(th, "w-10 pl-0 text-left sm:w-14")}>{t("ins_rank")}</th>
            <th scope="col" className={cn(th, "text-left")}>{t("ins_question")}</th>
            <th scope="col" className={cn(th, "hidden w-[28%] sm:table-cell")}><span className="sr-only">{t("ins_asked_by")}</span></th>
            <th scope="col" className={cn(th, "w-24 pr-0 text-right")}>{t("ins_asked_by")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((q, k) => (
            <tr key={q.en}>
              <td className="num border-b border-r-line-soft py-3 pr-2 align-top text-lg font-semibold text-r-returned">{k + 1}</td>
              <th scope="row" className="border-b border-r-line-soft px-2 py-3 text-left font-normal">
                <span lang="mr" className="block text-[17px] leading-snug font-semibold">“{q.mr}”</span>
                {lang === "en" && <span className="block text-sm text-r-muted">{q.en}</span>}
              </th>
              <td aria-hidden className="hidden border-b border-r-line-soft px-2 py-3 sm:table-cell">
                <span className="block h-2.5 overflow-hidden rounded-full bg-r-line-soft">
                  <span className={cn("block h-full rounded-full", k === 0 ? "bg-r-action" : "bg-r-seq-3")} style={{ width: `${(q.n / max) * 100}%` }} />
                </span>
              </td>
              <td className="num border-b border-r-line-soft py-3 pl-2 text-right text-lg font-semibold">{q.n.toLocaleString("en-IN")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </RCard>
  );
}

/** Average views per post each week since tracking began, with the campaign weeks shaded. */
function SinceTracking() {
  const { t, tf, lang } = useT();
  const s = OVERVIEW.since;
  const n = s.trend.length;
  // one point per week, the last being this week (starting WEEK.start)
  const data = s.trend.map((v, i) => {
    const d = new Date(WEEK.start + "T00:00:00");
    d.setDate(d.getDate() - (n - 1 - i) * 7);
    return { i, v, date: dmy(d), campaign: i > s.campaignFrom };
  });
  const ticks = data.filter((r) => (n - 1 - r.i) % 2 === 0).map((r) => r.i);
  const c = chartChrome();
  const ratio = (s.now / s.before).toFixed(1);
  return (
    <section className="flex flex-wrap items-center gap-x-8 gap-y-5 rounded-2xl bg-r-accepted-soft px-6 py-5">
      <div className="flex min-w-0 flex-[1_1_280px] flex-col">
        <Eyebrow className="text-r-accepted">{tf("ins_since", { d: bi(s.start, lang) })}</Eyebrow>
        <span className="disp text-[22px] leading-snug font-bold">{tf("ins_since_body", { m: ratio })}</span>
      </div>
      <div className="flex items-center gap-3.5">
        <div className="flex flex-col"><span className="text-[13px] text-r-muted">{t("ins_july_avg")}</span><span className="num text-[26px] font-semibold text-r-muted">{s.before.toLocaleString("en-IN")}</span></div>
        <ArrowRight className="size-7 text-r-accepted" aria-hidden />
        <div className="flex flex-col"><span className="text-[13px] text-r-muted">{t("ins_this_week")}</span><span className="num text-[26px] font-semibold text-r-accepted">{s.now.toLocaleString("en-IN")}</span></div>
      </div>
      <div className="flex basis-full flex-col gap-1.5">
        <div role="img" aria-label={tf("ins_since_chart", { n, a: s.before.toLocaleString("en-IN"), b: s.now.toLocaleString("en-IN") })} className="h-[210px] w-full">
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid {...c.grid} />
              <ReferenceArea x1={s.campaignFrom} x2={n - 1} fill="var(--r-accepted)" fillOpacity={0.1} ifOverflow="extendDomain"
                label={{ value: t("ins_campaign"), position: "insideTopLeft", fill: "var(--r-accepted)", fontSize: 13, fontWeight: 700 }} />
              <XAxis dataKey="i" type="number" domain={[0, n - 1]} ticks={ticks} {...c.xAxis}
                tickFormatter={(i: number) => i === n - 1 ? t("ins_this_week") : data[i]?.date ?? ""} />
              <YAxis {...c.axis} width={44} domain={[0, "auto"]} tickFormatter={axisNum} />
              <ReferenceLine y={s.before} stroke="var(--r-muted)" strokeOpacity={0.6} strokeDasharray="4 5"
                label={{ value: t("ins_july_avg"), position: "insideBottomLeft", fill: "var(--r-muted)", fontSize: 12 }} />
              <Tooltip cursor={c.cursor} isAnimationActive={false} content={({ active, payload }) => {
                const r = active && payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!r) return null;
                return <ChartTip title={r.i === n - 1 ? t("ins_this_week") : tf("ins_week_of", { d: r.date })}
                  foot={<>{tf("ins_vs_july", { p: pctChange(r.v, s.before) })}{r.campaign && <> · <span className="text-r-accepted">{t("ins_campaign")}</span></>}</>}
                  rows={[{ key: <SolidKey className="bg-r-accepted" />, value: fullNum(r.v), label: t("ins_avg_per_post") }]} />;
              }} />
              <Area dataKey="v" type="linear" stroke="var(--r-accepted)" strokeWidth={3} fill="var(--r-accepted)" fillOpacity={0.1}
                dot={{ r: 3, fill: "var(--r-accepted)", stroke: "var(--r-accepted-soft)", strokeWidth: 2 }}
                activeDot={{ r: 6, fill: "var(--r-accepted)", stroke: "var(--r-accepted-soft)", strokeWidth: 2 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <span className="basis-full text-[13px] text-r-muted">{tf("ins_since_note", { n: s.accounts })}</span>
    </section>
  );
}
