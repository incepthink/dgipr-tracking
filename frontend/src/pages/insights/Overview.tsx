import { Link } from "react-router-dom";
import { TrendingUp, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLATFORM_LABEL } from "@/lib/status";
import { useT } from "@/lib/i18n";
import { RCard, RPage } from "@/components/reports/kit";
import { rangeLabel } from "@/pages/monitor/shared";
import { CAMPAIGN, OVERVIEW, POSTS, WEEK } from "./sample";
import { bi, Eyebrow, InsightsTabs, InsightsTitle, linePath, mult, SectionHead, Thumb, views } from "./kit";

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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-4">
          {best.map((p) => (
            <Link key={p.id} to={`/insights/posts/${p.id}`} className="flex flex-col overflow-hidden rounded-2xl bg-r-card text-r-ink no-underline hover:ring-2 hover:ring-r-line">
              <Thumb tint={p.tint} video={p.format.endsWith("video")} className="h-40" />
              <div className="flex flex-col gap-2 px-[18px] pt-4 pb-[18px]">
                <span className="text-sm text-r-muted">{lang === "en" ? p.office.name_en : p.office.name_mr} · {PLATFORM_LABEL[p.platform]}</span>
                <span lang="mr" className="text-[17px] leading-snug font-semibold">{p.caption}</span>
                <span className="text-[15px]"><b className="num text-r-accepted">{mult(p.mult)}</b> {t("ins_better_than_usual")} · {tf("ins_n_views", { v: views(p.views) })}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <RCard className="gap-4 px-6 py-5">
        <SectionHead title={t("ins_asking")}><span className="text-sm text-r-muted">{t("ins_asking_hint")}</span></SectionHead>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-3.5">
          {o.questions.map((q) => (
            <div key={q.en} className="flex flex-col gap-1.5 rounded-xl bg-r-ground px-[18px] py-4">
              <span className="num text-2xl font-semibold text-r-action">{q.n.toLocaleString("en-IN")}</span>
              <span className="text-[13px] text-r-muted">{t("ins_people_asked")}</span>
              <span lang="mr" className="text-[17px] leading-snug font-semibold">“{q.mr}”</span>
              {lang === "en" && <span className="text-sm text-r-muted">{q.en}</span>}
            </div>
          ))}
        </div>
      </RCard>

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

/** The one big number, with this week's views per day against last week's. */
function WeekViews() {
  const { t, lang } = useT();
  const o = OVERVIEW;
  const box = { w: 440, h: 140, max: 8, padX: 10, padY: 10 };
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
        <svg viewBox={`0 0 ${box.w} ${box.h}`} role="img" aria-label={label} className="h-[150px] w-full" preserveAspectRatio="none">
          <path d={linePath(o.lastWeek, box)} fill="none" stroke="#7d878f" strokeWidth={2} strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
          <path d={linePath(o.thisWeek, box)} fill="none" stroke="#f2b544" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="flex justify-between text-xs text-r-nav-muted">{(lang === "en" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["सोम", "मंगळ", "बुध", "गुरु", "शुक्र", "शनि", "रवि"]).map((d) => <span key={d}>{d}</span>)}</div>
        <div className="flex gap-5 text-sm text-r-nav-text">
          <span className="flex items-center gap-2"><span className="h-1 w-[18px] rounded-sm bg-r-focus" />{t("ins_this_week")}</span>
          <span className="flex items-center gap-2"><span className="w-[18px] border-t-2 border-dashed border-[#7d878f]" />{t("ins_last_week")}</span>
        </div>
      </div>
    </section>
  );
}

/** Average views per post each week since tracking began, with the campaign weeks shaded. */
function SinceTracking() {
  const { t, tf, lang } = useT();
  const s = OVERVIEW.since;
  const n = s.trend.length;
  // Stretched to the card width (preserveAspectRatio="none"); labels and the end dot are HTML so they don't distort.
  const tx = (i: number) => i * (1000 / (n - 1));
  const ty = (v: number) => 150 - (v / 3600) * 130;
  const path = s.trend.map((v, i) => `${i ? "L" : "M"}${tx(i).toFixed(1)} ${ty(v).toFixed(1)}`).join(" ");
  const camp = tx(s.campaignFrom);
  const pct = (x: number) => `${x / 10}%`;
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
        <div className="relative h-[150px] pr-2 pt-2">
          <div className="pointer-events-none absolute inset-y-0 right-0 rounded-md bg-r-accepted/12" style={{ left: `calc((100% - 0.5rem) * ${camp / 1000})` }}>
            <span className="absolute left-3 top-2 text-[13px] font-bold text-r-accepted">{t("ins_campaign")}</span>
          </div>
          <svg viewBox="0 0 1000 150" preserveAspectRatio="none" role="img" className="relative block h-full w-full overflow-visible"
            aria-label={tf("ins_since_chart", { n, a: s.before.toLocaleString("en-IN"), b: s.now.toLocaleString("en-IN") })}>
            <line x1={0} x2={1000} y1={ty(s.before)} y2={ty(s.before)} className="stroke-r-muted" strokeWidth={1.5} strokeDasharray="4 5" strokeOpacity={0.6} vectorEffect="non-scaling-stroke" />
            <path d={`${path} L${tx(n - 1)} 150 L${tx(0)} 150 Z`} className="fill-r-accepted" fillOpacity={0.1} />
            <path d={path} fill="none" className="stroke-r-accepted" strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-r-accepted-soft bg-r-accepted"
            style={{ left: `calc(${pct(tx(n - 1))} - 0.5rem)`, top: `calc(0.5rem + (100% - 0.5rem) * ${ty(s.now) / 150})` }} aria-hidden />
        </div>
        <div className="flex justify-between text-[13px] text-r-muted">
          <span>{lang === "en" ? "21 Jul" : "२१ जुलै"}</span>
          <span>{t("ins_this_week")}</span>
        </div>
      </div>
      <span className="basis-full text-[13px] text-r-muted">{tf("ins_since_note", { n: s.accounts })}</span>
    </section>
  );
}
