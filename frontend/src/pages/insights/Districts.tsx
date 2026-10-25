import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { RCard, RPage, RSegmented } from "@/components/reports/kit";
import { BEST_TIME, DISTRICT_OF_WEEK, DISTRICTS, FORMATS, MOVES, NEED_CALL, type Office } from "./sample";
import { bi, Eyebrow, FORMAT_LABEL, InsightsTabs, InsightsTitle, Legend, mult, SectionHead } from "./kit";

type By = "er" | "imp";

/** Districts ranked fairly (by rate, not size), who moved since last month, and when and what to post. */
export default function InsightsDistricts() {
  const { t, lang } = useT();
  const [by, setBy] = React.useState<By>("er");
  const nm = (o: Office) => (lang === "en" ? o.name_en : o.name_mr);

  return (
    <RPage className="gap-7">
      <InsightsTitle title={t("ins_districts")} sub={t("ins_districts_sub")}
        actions={<RSegmented label={t("ins_rank_by")} value={by} onChange={setBy}
          options={[{ value: "er", label: t("ins_engagement") }, { value: "imp", label: t("ins_most_improved") }]} />} />
      <InsightsTabs />

      <section className="flex flex-wrap items-start gap-5">
        <Ranking by={by} />
        <div className="flex min-w-0 flex-[2_1_320px] flex-col gap-5">
          <div className="flex flex-col gap-2 rounded-[18px] bg-r-hero px-6 py-6 text-white">
            <Eyebrow className="text-r-focus">{t("ins_district_of_week")}</Eyebrow>
            <span className="disp text-[32px] font-bold">{nm(DISTRICT_OF_WEEK.office)}</span>
            <span className="text-r-nav-text">{t("ins_dow_body")}</span>
            <Link to={`/insights/posts/${DISTRICT_OF_WEEK.postId}`} className="mt-1.5 self-start rounded-[10px] bg-r-focus px-4 py-2.5 font-bold text-[#15202b] no-underline hover:brightness-95">{t("ins_see_their_post")}</Link>
          </div>
          <RCard className="gap-3.5 px-6 py-6">
            <h2 className="disp m-0 text-[22px] font-bold">{t("ins_need_call")}</h2>
            {NEED_CALL.map((h) => (
              <div key={h.office.code} className="flex flex-col border-t border-r-line-soft pt-3">
                <span className="font-bold">{nm(h.office)}</span>
                <span className="text-sm text-r-muted">{bi(h.t, lang)}</span>
              </div>
            ))}
          </RCard>
        </div>
      </section>

      <Moves />

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] gap-5">
        <BestTime />
        <WhatWorks />
      </section>
    </RPage>
  );
}

const RANK_COLS = "grid-cols-[40px_minmax(0,1fr)_minmax(0,1.2fr)_76px] sm:grid-cols-[56px_minmax(0,1fr)_minmax(0,1.2fr)_90px]";

function Ranking({ by }: { by: By }) {
  const { t, tf, lang } = useT();
  const key = by === "er" ? "er" : "imp";
  const rows = DISTRICTS.slice().sort((a, b) => b[key] - a[key]).slice(0, 10);
  const max = rows[0][key];
  return (
    <div className="min-w-0 flex-[3_1_480px] rounded-[18px] bg-r-card py-2.5">
      <div className={`grid ${RANK_COLS} gap-3 px-5 py-2.5 text-[13px] font-bold text-r-muted sm:gap-4 sm:px-6`}>
        <span>{t("ins_rank")}</span><span>{t("ins_district")}</span><span />
        <span className="text-right">{by === "er" ? t("ins_engagement") : t("ins_change")}</span>
      </div>
      <ol className="m-0 list-none p-0">
        {rows.map((d, k) => {
          const mv = d.lastRank - (k + 1);
          const sub = by !== "er" ? tf("ins_engagement_now", { v: d.er.toFixed(1) })
            : mv > 0 ? tf("ins_up_places", { n: mv }) : mv < 0 ? tf("ins_down_places", { n: -mv }) : t("ins_same_place");
          return (
            <li key={d.office.code} className={`grid ${RANK_COLS} items-center gap-3 border-t border-r-line-soft px-5 py-3 sm:gap-4 sm:px-6`}>
              <span className={cn("num text-lg font-semibold", k < 3 ? "text-r-returned" : "text-r-ink")}>{k + 1}</span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[17px] font-bold">{lang === "en" ? d.office.name_en : d.office.name_mr}</span>
                <span className={cn("text-[13px]", by === "er" && mv > 0 ? "text-r-accepted" : by === "er" && mv < 0 ? "text-r-overdue" : "text-r-muted")}>{sub}</span>
              </div>
              <span aria-hidden className="h-2.5 overflow-hidden rounded-full bg-r-line-soft">
                <span className={cn("block h-full rounded-full", k < 3 ? "bg-r-action" : "bg-r-seq-3")} style={{ width: `${(d[key] / max) * 100}%` }} />
              </span>
              <span className="num text-right text-lg font-semibold">{by === "er" ? d.er.toFixed(1) + "%" : (d.imp >= 0 ? "+" : "") + d.imp.toFixed(1) + " pt"}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Each district's engagement per post in September (grey) and October (blue), on one 1–7% scale. */
function Moves() {
  const { t, lang } = useT();
  const pct = (v: number) => ((v - 1) / 6) * 100;
  return (
    <RCard className="gap-3.5 px-7 py-6">
      <SectionHead title={t("ins_who_moved")}>
        <Legend items={[
          { label: t("ins_september"), swatch: <span className="size-3 rounded-full bg-r-field" /> },
          { label: t("ins_october"), swatch: <span className="size-3 rounded-full bg-r-action" /> },
        ]} />
      </SectionHead>
      {MOVES.map((m) => {
        const d = m.oct - m.sep;
        const tone = d >= 0.3 ? "text-r-accepted" : d <= -0.3 ? "text-r-overdue" : "text-r-muted";
        const bar = d >= 0.3 ? "bg-r-accepted" : d <= -0.3 ? "bg-r-overdue" : "bg-r-muted";
        const name = lang === "en" ? m.office.name_en : m.office.name_mr;
        return (
          <div key={m.office.code} className="grid grid-cols-[minmax(0,130px)_minmax(0,1fr)_72px] items-center gap-4 sm:grid-cols-[170px_minmax(0,1fr)_90px]"
            role="img" aria-label={`${name}: ${m.sep}% → ${m.oct}%`}>
            <span className="truncate font-bold">{name}</span>
            <div className="relative h-[22px]">
              <span className="absolute inset-x-0 top-2.5 h-0.5 bg-r-line-soft" />
              <span className={cn("absolute top-[9px] h-1 rounded-sm", bar)} style={{ left: `${pct(Math.min(m.sep, m.oct))}%`, width: `${(Math.abs(d) / 6) * 100}%` }} />
              <span className="absolute top-1 -ml-[7px] size-3.5 rounded-full bg-r-field" style={{ left: `${pct(m.sep)}%` }} />
              <span className="absolute top-[3px] -ml-2 size-4 rounded-full border-2 border-r-card bg-r-action" style={{ left: `${pct(m.oct)}%` }} />
            </div>
            <span className={cn("num text-right font-semibold", tone)}>{(d > 0 ? "+" : "") + d.toFixed(1)} pt</span>
          </div>
        );
      })}
      <span className="text-sm text-r-muted">{t("ins_moves_note")}</span>
    </RCard>
  );
}

const HEAT_BG = ["bg-r-line-soft", "bg-r-seq-1", "bg-r-seq-2", "bg-r-seq-4", "bg-r-seq-5"];

function BestTime() {
  const { t, lang } = useT();
  const days = lang === "en" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["सोम", "मंगळ", "बुध", "गुरु", "शुक्र", "शनि", "रवि"];
  const slots = lang === "en" ? ["6–10 am", "10–2", "2–6", "6–10 pm"] : ["स. ६–१०", "१०–२", "२–६", "सा. ६–१०"];
  return (
    <RCard className="gap-3.5 px-7 py-6">
      <h2 className="disp m-0 text-[22px] font-bold">{t("ins_best_time")}</h2>
      <div role="img" aria-label={t("ins_best_time_label")} className="grid grid-cols-[44px_repeat(4,minmax(0,1fr))] gap-[5px]">
        <span />
        {slots.map((s) => <span key={s} className="text-center text-[13px] text-r-muted">{s}</span>)}
        {BEST_TIME.map((row, k) => (
          <React.Fragment key={k}>
            <span className="flex items-center text-[13px] text-r-muted">{days[k]}</span>
            {row.map((v, j) => {
              const l = v >= 1.7 ? 4 : v >= 1.25 ? 3 : v >= 1.0 ? 2 : v >= 0.8 ? 1 : 0;
              return <span key={j} className={cn("num flex h-[34px] items-center justify-center rounded-md text-[13px]", HEAT_BG[l], l >= 3 ? "text-r-card" : "text-r-ink")}>{mult(v)}</span>;
            })}
          </React.Fragment>
        ))}
      </div>
      <span className="text-sm text-r-muted">{t("ins_best_time_note")}</span>
    </RCard>
  );
}

function WhatWorks() {
  const { t } = useT();
  const USUAL = (1 / 2.5) * 100;
  return (
    <RCard className="gap-3.5 px-7 py-6">
      <h2 className="disp m-0 text-[22px] font-bold">{t("ins_what_works")}</h2>
      <div role="img" aria-label={FORMATS.map((f) => `${t(FORMAT_LABEL[f.format])} ${mult(f.mult)}`).join(", ")} className="flex flex-col gap-3.5 pt-1">
        {FORMATS.map((f, i) => (
          <div key={f.format} className="grid grid-cols-[110px_minmax(0,1fr)_54px] items-center gap-3.5">
            <span className="font-bold">{t(FORMAT_LABEL[f.format])}</span>
            <span className="relative h-[26px] rounded-lg bg-r-line-soft">
              <span className={cn("absolute inset-y-0 left-0 rounded-lg", ["bg-r-seq-5", "bg-r-seq-4", "bg-r-seq-2", "bg-r-field"][i])} style={{ width: `${(f.mult / 2.5) * 100}%` }} />
              <span className="absolute -inset-y-1 w-0.5 bg-r-ink" style={{ left: `${USUAL}%` }} />
            </span>
            <span className="num text-right text-[17px] font-semibold">{mult(f.mult)}</span>
          </div>
        ))}
      </div>
      <span className="text-sm text-r-muted">{t("ins_what_works_note")}</span>
    </RCard>
  );
}
