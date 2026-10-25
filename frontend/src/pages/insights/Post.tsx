import { Link, Navigate, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { PLATFORM_LABEL } from "@/lib/status";
import { RCard, RPage } from "@/components/reports/kit";
import { POSTS, type Post } from "./sample";
import { bi, CURVE_HOURS, FORMAT_LABEL, Legend, mult, postCurve, SectionHead, Thumb, usualCurve, views } from "./kit";

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/insights/posts" className="flex items-center gap-1 font-bold text-r-action no-underline"><ChevronLeft className="size-4" aria-hidden />{t("ins_all_posts")}</Link>
        <span className="rounded-full bg-r-returned-soft px-2.5 py-1 text-xs font-bold text-r-returned-ink" title={t("ins_sample_hint")}>{t("ins_sample")}</span>
      </div>

      <section className="flex flex-wrap gap-5">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col overflow-hidden rounded-[18px] bg-r-card">
          <Thumb tint={p.tint} video={p.format.endsWith("video")} className="h-[220px]" />
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

      {(p.sentiment || p.why) && (
        <section className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-5">
          {p.sentiment && (
            <RCard className="gap-3.5 px-7 py-6">
              <h2 className="disp m-0 text-[22px] font-bold">{t("ins_people_said")}</h2>
              <div aria-hidden className="flex h-3.5 gap-[3px] overflow-hidden rounded-full">
                <span className="bg-r-accepted" style={{ width: `${p.sentiment.pos}%` }} />
                <span className="bg-r-field" style={{ width: `${p.sentiment.neu}%` }} />
                <span className="bg-r-overdue" style={{ width: `${p.sentiment.neg}%` }} />
              </div>
              <span className="text-r-muted">{tf("ins_sentiment", { pos: p.sentiment.pos, neu: p.sentiment.neu, neg: p.sentiment.neg, n: p.sentiment.comments.toLocaleString("en-IN") })}</span>
              {p.topQuestion && (
                <div className="flex flex-col gap-1 rounded-xl bg-r-ground px-4 py-3.5">
                  <span className="text-[13px] font-bold text-r-muted uppercase">{tf("ins_most_asked", { n: p.topQuestion.n })}</span>
                  <span lang="mr" className="text-[17px] font-semibold">“{p.topQuestion.mr}”</span>
                  {lang === "en" && <span className="text-sm text-r-muted">{p.topQuestion.en}</span>}
                </div>
              )}
            </RCard>
          )}
          {p.why && (
            <div className="flex flex-col gap-3.5 rounded-[18px] bg-r-today px-7 py-6">
              <h2 className="disp m-0 text-[22px] font-bold">{p.mult >= 1 ? t("ins_why_worked") : t("ins_why_not")}</h2>
              {p.why.map((w, i) => (
                <div key={i} className="flex items-start gap-3.5">
                  <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-r-hero text-sm font-bold text-r-focus">{i + 1}</span>
                  <div className="flex flex-col"><span className="font-bold">{bi(w.t, lang)}</span><span className="text-sm text-r-muted">{bi(w.b, lang)}</span></div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </RPage>
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
  const usual = CURVE_HOURS.map((h) => at(usualFull, h));
  const max = Math.max(...actual, ...usual) * 1.08;

  const sx = (h: number) => 20 + Math.sqrt(h / 168) * 940;
  const sy = (v: number) => 230 - (v / max) * 200;
  const path = (hs: number[], vs: number[]) => hs.map((h, i) => `${i ? "L" : "M"}${sx(h).toFixed(1)} ${sy(vs[i]).toFixed(1)}`).join(" ");
  const endV = actual.at(-1)!;
  const usual7 = usual.at(-1)!;
  const ev = p.event && p.event.hour <= ageH ? p.event : undefined;
  const evV = ev ? at(full, ev.hour) * scale : 0;
  const label = tf("ins_growth_label", { v: views(endV * 1000), u: views(usual7 * 1000) });

  return (
    <RCard className="gap-3.5 px-7 py-6">
      <SectionHead title={t("ins_how_grew")}>
        <Legend items={[
          { label: t("ins_this_post"), swatch: <span className="h-1 w-[18px] rounded-sm bg-r-returned" /> },
          { label: t("ins_usual_post"), swatch: <span className="w-[18px] border-t-2 border-dashed border-r-seq-4" /> },
        ]} />
      </SectionHead>
      <svg viewBox="0 0 1000 260" role="img" aria-label={label} className="h-[260px] w-full">
        <line x1={20} x2={980} y1={230} y2={230} className="stroke-r-sunk" strokeWidth={2} />
        <path d={path(CURVE_HOURS, usual)} fill="none" className="stroke-r-seq-4" strokeWidth={2.5} strokeDasharray="7 6" />
        <path d={path(hours, actual)} fill="none" className="stroke-r-returned" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
        {ev && <>
          <circle cx={sx(ev.hour)} cy={sy(evV)} r={7} className="fill-r-ink" />
          <text x={sx(ev.hour) + 16} y={sy(evV) + 5} fontSize={15} fontWeight={700} className="fill-r-ink">{bi(ev.label, lang)}</text>
        </>}
        <text x={Math.min(975, sx(ageH))} y={sy(endV) - 12} textAnchor="end" fontSize={16} fontWeight={600} className="num fill-r-ink">{views(endV * 1000)}</text>
        <text x={975} y={sy(usual7) - 10} textAnchor="end" fontSize={14} className="num fill-r-action">{views(usual7 * 1000)}</text>
        <text x={20} y={254} fontSize={13} className="fill-r-muted">{t("ins_posted")}</text>
        <text x={sx(24)} y={254} textAnchor="middle" fontSize={13} className="fill-r-muted">{t("ins_1_day")}</text>
        <text x={980} y={254} textAnchor="end" fontSize={13} className="fill-r-muted">{t("ins_7_days")}</text>
      </svg>
      {!p.curve && p.daysAgo < 7 && <span className="text-sm text-r-muted">{t("ins_still_live")}</span>}
    </RCard>
  );
}
