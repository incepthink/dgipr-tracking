import * as React from "react";
import { Link } from "react-router-dom";
import { useT } from "@/lib/i18n";
import { RPage, RSearch, RSegmented } from "@/components/reports/kit";
import { PlatformBadge } from "@/pages/monitor/shared";
import { POSTS, type Post } from "./sample";
import { agoLabel, InsightsTabs, InsightsTitle, mult, multTone, Thumb, TONE_BG, TONE_STROKE, TONE_TEXT, views } from "./kit";

type Sort = "best" | "new" | "weak";
const COLS = "grid-cols-[52px_minmax(0,1fr)_96px] sm:grid-cols-[64px_minmax(0,1fr)_100px_96px_150px]";

/** Every campaign post this week, each compared with what its own account usually gets. */
export default function InsightsPosts() {
  const { t, tf, lang } = useT();
  const [sort, setSort] = React.useState<Sort>("best");
  const [q, setQ] = React.useState("");

  const needle = q.trim().toLowerCase();
  const rows = POSTS
    .filter((p) => !needle || [p.caption, p.office.name_mr, p.office.name_en, p.platform].some((s) => s.toLowerCase().includes(needle)))
    .sort((a, b) => sort === "best" ? b.mult - a.mult : sort === "new" ? a.daysAgo - b.daysAgo : a.mult - b.mult);

  return (
    <RPage>
      <InsightsTitle title={t("ins_posts")} sub={tf("ins_posts_sub", { n: "1,284" })} />
      <InsightsTabs />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <RSearch value={q} onChange={setQ} placeholder={t("ins_search_posts")} className="max-w-[460px] flex-[1_1_280px]" />
        <RSegmented label={t("ins_sort")} value={sort} onChange={setSort}
          options={[{ value: "best", label: t("ins_sort_best") }, { value: "new", label: t("ins_sort_new") }, { value: "weak", label: t("ins_sort_weak") }]} />
      </div>

      <section className="overflow-hidden rounded-2xl bg-r-card">
        <div className={`grid ${COLS} gap-4 border-b border-r-sunk px-5 py-3 text-[13px] font-bold text-r-muted`}>
          <span /><span>{t("ins_post")}</span>
          <span className="hidden sm:block">{t("ins_first_3_days")}</span>
          <span className="hidden text-right sm:block">{t("ins_views")}</span>
          <span className="text-right sm:text-left">{t("ins_vs_usual")}</span>
        </div>
        {rows.map((p) => <Row key={p.id} p={p} />)}
        {!rows.length && <p className="m-0 px-5 py-8 text-center text-r-muted">{t("ins_no_posts")}</p>}
      </section>
      <p className="m-0 text-sm text-r-muted">{t("ins_posts_note")}</p>
      <span className="sr-only" aria-live="polite">{lang === "en" ? `${rows.length} posts` : `${rows.length} पोस्ट`}</span>
    </RPage>
  );
}

function Row({ p }: { p: Post }) {
  const { t, tf, lang } = useT();
  const tone = multTone(p.mult);
  return (
    <Link to={`/insights/posts/${p.id}`} className={`grid ${COLS} items-center gap-4 border-b border-r-line-soft px-5 py-3.5 text-r-ink no-underline last:border-b-0 hover:bg-r-ground`}>
      <Thumb tint={p.tint} className="size-[52px] rounded-[10px] sm:size-16" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span lang="mr" className="line-clamp-2 font-semibold sm:line-clamp-none sm:truncate">{p.caption}</span>
        <span className="flex items-center gap-1.5 text-sm text-r-muted">
          <PlatformBadge platform={p.platform} className="size-[18px] rounded-[5px]" />
          <span className="truncate">{lang === "en" ? p.office.name_en : p.office.name_mr} · {agoLabel(p.daysAgo, t, tf)}<span className="sm:hidden"> · {views(p.views)}</span></span>
        </span>
      </div>
      <Spark p={p} />
      <span className="num hidden text-right text-[17px] font-semibold sm:block">{views(p.views)}</span>
      <div className="flex items-center justify-end gap-2.5 sm:justify-start">
        <span className="hidden h-2 w-16 overflow-hidden rounded bg-r-sunk sm:block"><span className={`block h-full ${TONE_BG[tone]}`} style={{ width: `${Math.min(100, (p.mult / 5) * 100)}%` }} /></span>
        <span className={`num font-semibold ${TONE_TEXT[tone]}`}>{mult(p.mult)}</span>
      </div>
    </Link>
  );
}

/** Views over the first three days against a usual post (dashed). */
const SHAPE = [0, 0.3, 0.55, 0.72, 0.84, 0.92, 1.0];
function Spark({ p }: { p: Post }) {
  const { lang } = useT();
  const growing = p.daysAgo <= 1;
  const curve = (m: number, still: boolean) => SHAPE.map((s, k) => {
    const v = still && k >= 4 ? s * m * (1 + (k - 3) * 0.12) : s * m;
    return `${k ? "L" : "M"}${(4 + k * 15.3).toFixed(1)} ${(33 - (Math.min(v, 5.4) / 5.4) * 30).toFixed(1)}`;
  }).join(" ");
  const label = lang === "en"
    ? `Views over the first 3 days: ${mult(p.mult)} a usual post${growing ? ", still growing" : ""}`
    : `पहिल्या ३ दिवसांतील व्ह्यूज: नेहमीच्या पोस्टच्या ${mult(p.mult)}${growing ? ", अजून वाढत आहे" : ""}`;
  return (
    <svg viewBox="0 0 100 36" role="img" aria-label={label} className="hidden h-9 w-[100px] sm:block">
      <path d={curve(1, false)} fill="none" className="stroke-r-field" strokeWidth={1.5} strokeDasharray="3 3" />
      <path d={curve(p.mult, growing)} fill="none" className={TONE_STROKE[multTone(p.mult)]} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
