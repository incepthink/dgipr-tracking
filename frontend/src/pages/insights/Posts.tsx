import * as React from "react";
import { ExternalLink, FileText, Image as ImageIcon, Link2 } from "lucide-react";
import { proofFileUrl, type PostItem, type PostsData } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RButton, RCard, RError, RPage, RSearch, RTitle } from "@/components/reports/kit";
import { fig, longDay } from "@/components/reports/period";
import { useFormFilters } from "../forms/common";
import { AnalyticsFilters, AnalyticsTabs, Pending, useAnalytics } from "./shell";

const PAGE = 60;

/** Analytics → Posts: the posts (links) and clippings/photos (files) the offices attached as proof, from the database —
 * per field, how many were reported and how many have a link or file behind them; then every item by day, each opening
 * the post or file itself. */
export default function InsightsPosts() {
  const { t, tf, lang } = useT();
  const f = useFormFilters(7);
  const posts = useAnalytics<PostsData>(f, "posts");
  const [field, setField] = React.useState("");
  const [q, setQ] = React.useState("");
  const [shown, setShown] = React.useState(PAGE);
  React.useEffect(() => setShown(PAGE), [field, q, f.formId, f.start, f.end, f.division]);

  const label = (x: { field_mr?: string; field_en?: string; label_mr?: string; label_en?: string }) =>
    lang === "en" ? x.field_en || x.label_en || x.field_mr || x.label_mr || "" : x.field_mr || x.label_mr || "";
  const needle = q.trim().toLowerCase();
  const items = (posts.data?.items ?? []).filter((x) => (!field || x.field === field)
    && (!needle || [x.name_mr, x.name_en, x.division_mr, x.office, x.host ?? "", x.url ?? ""].some((s) => s.toLowerCase().includes(needle))));
  const byDay = React.useMemo(() => {
    const m = new Map<string, PostItem[]>();
    items.slice(0, shown).forEach((x) => m.set(x.date, [...(m.get(x.date) ?? []), x]));
    return [...m.entries()];
  }, [items, shown]);
  // only fields that have proof behind them; the rest would be a wall of zeros
  const fields = (posts.data?.fields ?? []).filter((c) => c.links > 0 || c.files > 0);

  return (
    <RPage>
      <RTitle title={t("ins_posts")} sub={t("po_sub")} />
      <AnalyticsTabs />
      <AnalyticsFilters f={f} />
      {posts.error ? <RError error={posts.error} /> : !posts.data ? <Pending h="h-96" /> : (
        <>
          {/* one button per field: what was reported, and how much proof is behind it */}
          <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5" role="group" aria-label={t("field")}>
            <FieldButton on={!field} onClick={() => setField("")} title={t("po_all")} big={fig(posts.data.total)} sub="" />
            {fields.map((c) => (
              <FieldButton key={c.key} on={field === c.key} onClick={() => setField(c.key)} title={label(c)} big={fig(c.links + c.files)}
                sub={tf("po_counts", { n: fig(c.reported), l: fig(c.links), f: fig(c.files) })} />
            ))}
          </div>

          <RSearch value={q} onChange={setQ} placeholder={t("po_search")} />

          {!items.length ? <p className="m-0 rounded-2xl bg-r-card p-5 text-r-muted">{t("po_none")}</p> : (
            <div className="flex flex-col gap-5">
              {byDay.map(([day, list]) => (
                <section key={day} className="flex flex-col gap-2">
                  <h2 className="m-0 px-1 text-[15px] font-bold text-r-muted">{longDay(day, lang)} · <span className="num">{list.length}</span></h2>
                  <RCard className="gap-0 p-0">
                    {list.map((x, i) => <PostRow key={x.id} x={x} first={i === 0} formId={f.formId} fieldName={label(x)} />)}
                  </RCard>
                </section>
              ))}
              {items.length > shown && (
                <div className="flex flex-wrap items-center gap-3">
                  <RButton onClick={() => setShown((n) => n + PAGE)}>{tf("po_more", { n: Math.min(PAGE, items.length - shown) })}</RButton>
                  <span className="text-sm text-r-muted">{tf("po_shown", { a: fig(items.length), b: fig(shown) })}</span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </RPage>
  );
}

function FieldButton({ on, onClick, title, big, sub }: { on: boolean; onClick: () => void; title: string; big: string; sub: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn("flex min-h-20 cursor-pointer flex-col items-start gap-0.5 rounded-2xl border-[1.5px] px-4 py-3 text-left",
        on ? "border-r-ink bg-r-ink text-r-card" : "border-r-line bg-r-card text-r-ink hover:border-r-action")}>
      <span className="text-sm font-bold first-letter:uppercase">{title}</span>
      <span className="num text-2xl leading-tight font-bold">{big}</span>
      {sub && <span className={cn("num text-xs", on ? "opacity-80" : "text-r-muted")}>{sub}</span>}
    </button>
  );
}

function PostRow({ x, first, formId, fieldName }: { x: PostItem; first: boolean; formId: number; fieldName: string }) {
  const { t, shortName: name } = useT();
  const href = x.kind === "link" ? x.url ?? "#" : proofFileUrl(formId, x.id);
  let path = "";
  try { if (x.url) { const u = new URL(x.url); path = (u.pathname + u.search).replace(/\/$/, ""); } } catch { /* shown as is */ }
  const Icon = x.kind === "link" ? Link2 : x.type?.startsWith("image/") ? ImageIcon : FileText;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className={cn("group flex min-h-16 items-center gap-3 px-4 py-3 text-r-ink no-underline hover:bg-r-action-soft", !first && "border-t border-r-line-soft")}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-r-action-soft text-r-action"><Icon className="size-5" aria-hidden /></span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <b className="truncate">{name(x)}</b>
          <span className="rounded-full bg-r-sunk px-2 py-px text-xs font-bold first-letter:uppercase">{fieldName}</span>
        </span>
        <span className="truncate text-[13px] text-r-muted">
          {x.kind === "link" ? <><b className="text-r-ink">{x.host}</b>{path.length > 50 ? path.slice(0, 48) + "…" : path}</> : x.name}
        </span>
      </span>
      <ExternalLink className="size-4 shrink-0 text-r-muted group-hover:text-r-action" aria-label={t("link_open")} />
    </a>
  );
}
