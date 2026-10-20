import type { Movers, MoverRow } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RCard, RCardTitle } from "@/components/reports/kit";
import { fig } from "@/components/reports/period";

/**
 * Rank and most improved, always together. Rank is by average per reported day, so an office is not ranked low
 * for having sent fewer days (that shows in reporting %). Most improved compares that average with the range
 * before, among offices that sent at least half their days in both.
 */
export function MoversCard({ data, title, controls, pending }: { data?: Movers; title: string; controls?: React.ReactNode; pending?: boolean }) {
  const { t, tf } = useT();
  return (
    <RCard className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RCardTitle>{title}</RCardTitle>
        {controls}
      </div>
      {!data ? <div className="h-56 animate-pulse rounded-lg bg-r-sunk" /> : (
        <div className={cn("grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-5 transition-opacity", pending && "opacity-60")}>
          <Column title={t("mv_top")} hint={t("mv_top_hint")} rows={data.top} value={(r) => fig(r.per_day)}
            bar={(r) => r.per_day ?? 0} sub={(r) => tf("mv_sent", { a: r.sent, b: r.due })} />
          <Column title={t("mv_improved")} hint={data.comparable ? tf("mv_improved_hint", { p: Math.round(data.eligible_share * 100) }) : ""}
            rows={data.improved} value={(r) => (r.delta_pct === null || r.delta_pct === undefined ? t("mv_new") : `+${Math.round(r.delta_pct)}%`)}
            bar={(r) => r.change ?? 0} sub={(r) => `${fig(r.previous_per_day)} → ${fig(r.per_day)}`} tone="good"
            empty={data.comparable ? t("mv_none_improved") : t("no_compare")} />
        </div>
      )}
    </RCard>
  );
}

function Column({ title, hint, rows, value, bar, sub, tone, empty }: {
  title: string; hint: string; rows: MoverRow[]; value: (r: MoverRow) => string; bar: (r: MoverRow) => number;
  sub: (r: MoverRow) => string; tone?: "good"; empty?: string;
}) {
  const { t, name } = useT();
  const max = Math.max(1e-9, ...rows.map(bar));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-col">
        <b>{title}</b>
        <span className="text-xs text-r-muted">{hint}</span>
      </div>
      {!rows.length ? <span className="text-sm text-r-faint">{empty ?? t("no_data_range")}</span> : (
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {rows.slice(0, 8).map((r, i) => (
            <li key={r.code} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-2.5 text-sm" title={`${name(r)}: ${value(r)} · ${sub(r)}`}>
              <span className="num text-r-muted">{i + 1}</span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate">{name(r)}</span>
                <span className="h-1.5 rounded bg-r-sunk"><span className={cn("block h-1.5 rounded", tone === "good" ? "bg-r-accepted" : "bg-r-action")} style={{ width: `${(100 * bar(r)) / max}%`, minWidth: 2 }} /></span>
              </span>
              <span className="flex flex-col items-end leading-tight">
                <b className="num">{value(r)}</b>
                <span className="num text-[11px] text-r-muted">{sub(r)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
