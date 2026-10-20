import * as React from "react";
import { Link } from "react-router-dom";
import { CalendarX, Copy as CopyIcon, PencilLine, TrendingUp } from "lucide-react";
import type { Attention, AttentionItem, FormField } from "@/lib/api";
import { useT, type TKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RCard, RCardTitle, RChip } from "@/components/reports/kit";
import { dayMonth, fig } from "@/components/reports/period";
import { fieldLabel } from "@/pages/forms/common";

/**
 * आज लक्ष द्या: the reporting status of the latest due period with the missing offices named, then the exceptions
 * (miss streaks, unusual figures, repeated rows, corrections), each linked to the responses for that day. Every
 * list is empty-stated in words, so "nothing to check" reads as an answer rather than as a gap.
 */
export function AttentionList({ data, fields, extra }: { data: Attention; fields: FormField[]; extra?: React.ReactNode }) {
  const { t, tf, name, lang } = useT();
  const label = (k: string | null) => { const f = fields.find((x) => x.key === k); return f ? fieldLabel(f, lang) : k ?? ""; };
  const pct = data.offices ? (100 * data.sent) / data.offices : 0;
  const [all, setAll] = React.useState(false);
  const shown = all ? data.missing : data.missing.slice(0, 18);
  return (
    <RCard className="gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <RCardTitle>{t("att_title")}</RCardTitle>
          {data.period && <span className="text-sm text-r-muted">{tf("att_for", { day: dayMonth(data.period, lang) })}</span>}
        </div>
        {extra}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="disp num text-[40px] leading-none font-bold">{data.sent}<span className="text-[22px] text-r-muted"> / {data.offices}</span></span>
          <span className="text-r-muted">{t("att_reported")}</span>
        </div>
        <div className="h-2 rounded bg-r-sunk" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={t("att_reported")}>
          <div className="h-2 rounded bg-r-accepted" style={{ width: `${pct}%` }} />
        </div>
        {data.missing.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-bold text-r-overdue-ink">{tf("att_missing_n", { n: data.missing.length })}</span>
            <div className="flex flex-wrap gap-1.5">
              {shown.map((x) => (
                <Link key={x.office} to={x.link} className="rounded-full border-[1.5px] border-dashed border-r-overdue px-2.5 py-0.5 text-[13px] font-bold text-r-ink no-underline hover:bg-r-overdue-soft">
                  {name(x)}{x.status === "draft" && <span className="font-normal text-r-muted"> · {t("sub_draft")}</span>}
                </Link>
              ))}
              {data.missing.length > shown.length && (
                <button type="button" onClick={() => setAll(true)} className="cursor-pointer rounded-full border-0 bg-r-sunk px-2.5 py-0.5 text-[13px] font-bold text-r-ink">
                  {tf("att_more", { n: data.missing.length - shown.length })}
                </button>
              )}
            </div>
          </div>
        ) : data.period ? <span className="font-bold text-r-accepted">{t("att_all_in")}</span> : null}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(230px,100%),1fr))] gap-3">
        <Group icon={CalendarX} title="att_streaks" hint="att_streaks_hint" items={data.streaks} render={(x) => (
          <><b>{name(x)}</b> <span className="text-r-muted">{x.ever ? tf("att_streak_n", { n: x.value ?? 0, day: dayMonth(x.since ?? x.date, lang) }) : t("att_never")}</span></>
        )} />
        <Group icon={TrendingUp} title="att_spikes" hint="att_spikes_hint" items={data.spikes} render={(x) => (
          <><b>{name(x)}</b> <span className="text-r-muted">{label(x.field)}: </span><b className="num">{fig(x.value)}</b>
            <span className="text-r-muted"> · {tf("att_usual", { n: fig(x.expected) })}</span></>
        )} />
        <Group icon={CopyIcon} title="att_repeats" hint="att_repeats_hint" items={data.repeats} render={(x) => (
          <><b>{name(x)}</b> <span className="text-r-muted">{tf("att_same_as", { day: dayMonth(x.previous ?? x.date, lang) })}</span></>
        )} />
        <Group icon={PencilLine} title="att_corrections" hint="att_corrections_hint" items={data.corrections} render={(x) => (
          <><b>{name(x)}</b> <span className="text-r-muted">{dayMonth(x.date, lang)} · {label(x.field)}: </span>
            <span className="num text-r-muted line-through">{x.expected === null ? "—" : fig(x.expected)}</span> → <b className="num text-r-corrected-ink">{fig(x.value)}</b></>
        )} />
      </div>
    </RCard>
  );
}

function Group({ icon: Icon, title, hint, items, render }: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; title: TKey; hint: TKey; items: AttentionItem[];
  render: (x: AttentionItem) => React.ReactNode;
}) {
  const { t } = useT();
  const [open, setOpen] = React.useState(false);
  const shown = open ? items : items.slice(0, 5);
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border-[1.5px] p-3", items.length ? "border-r-line" : "border-r-sunk")}>
      <div className="flex items-center gap-2">
        <Icon className={cn("size-4", items.length ? "text-r-returned" : "text-r-faint")} aria-hidden />
        <b className="text-sm">{t(title)}</b>
        <RChip className="ml-auto num">{items.length}</RChip>
      </div>
      <span className="text-xs text-r-muted">{t(hint)}</span>
      {!items.length ? <span className="text-sm text-r-faint">{t("att_none")}</span> : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
          {shown.map((x, i) => (
            <li key={`${x.office}-${x.date}-${x.field ?? ""}-${i}`}>
              <Link to={x.link} className="block rounded-md px-1 py-0.5 text-r-ink no-underline hover:bg-r-ground">{render(x)}</Link>
            </li>
          ))}
          {items.length > shown.length && (
            <li><button type="button" className="cursor-pointer border-0 bg-transparent p-0 px-1 text-sm font-bold text-r-action" onClick={() => setOpen(true)}>
              {t("show_all")} ({items.length})
            </button></li>
          )}
        </ul>
      )}
    </div>
  );
}
