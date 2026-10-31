import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ClipboardCheck, FilePlus2, ListChecks, Pause, Pencil, Play, Repeat, Send, Trash2, Users } from "lucide-react";
import { api, type FormBrief, type FormDef } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { useT, type TKey } from "@/lib/i18n";
import { cn, qs } from "@/lib/utils";
import { RButton, RCard, RError, RPage, RTitle } from "@/components/reports/kit";
import { dayMonth, fig, rangeText, whenText } from "@/components/reports/period";
import { formTitle } from "./common";
import { STATUS_DOT } from "../office/shared";
import { DeskSearch, useFormSearch } from "../office/Desk";


export default function FormsListPage() {
  const { t, tf } = useT();
  const nav = useNavigate();
  const { data, error, isLoading } = useQuery({
    queryKey: ["forms", { archived: true }], queryFn: () => api.get<FormBrief[]>("/api/forms?archived=true"),
  });
  const { q, setQ, needle, shown, campaignOf, onPick } = useFormSearch(data ?? []);
  return (
    <RPage>
      <RTitle title={t("forms_title")}
        actions={<RButton variant="pri" onClick={() => nav("/forms/new")}><FilePlus2 aria-hidden /> {t("new_form")}</RButton>} />
      {!!data?.length && <DeskSearch q={q} setQ={setQ} forms={data} campaignOf={campaignOf} onPick={onPick} />}
      {error ? <RError error={error} /> : isLoading || !data ? (
        <div className="grid gap-4 lg:grid-cols-2">{[0, 1].map((i) => <div key={i} className="h-48 animate-pulse rounded-2xl bg-r-sunk" />)}</div>
      ) : !data.length ? (
        <RCard className="items-start gap-3 p-6 shadow-[0_1px_2px_rgb(21_32_43/0.06),0_4px_12px_rgb(21_32_43/0.06)]">
          <h2 className="disp m-0 text-[22px] font-bold">{t("no_forms")}</h2>
          <p className="m-0 text-r-muted">{t("no_forms_state")}</p>
          <RButton variant="pri" onClick={() => nav("/forms/new")}><FilePlus2 aria-hidden /> {t("new_form")}</RButton>
        </RCard>
      ) : needle && !shown.length ? (
        <p className="m-0 px-1 text-sm text-r-muted">{tf("desk_no_match", { q: q.trim() })}</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">{shown.map((f) => <FormCard key={f.id} f={f} />)}</div>
      )}
    </RPage>
  );
}

function FormCard({ f }: { f: FormBrief }) {
  const { t, tf, lang } = useT();
  const inv = [["forms"], ["forms-mine"], ["form", f.id]];
  const status = useAction((s: string) => api.post<FormDef>(`/api/forms/${f.id}/${s}`), { invalidate: inv, success: (r) => t(`status_${r.status}` as TKey) });
  const del = useAction(() => api.del(`/api/forms/${f.id}`), { invalidate: inv, success: () => t("deleted") });
  const restore = useAction(() => api.post<FormDef>(`/api/forms/${f.id}/restore`), { invalidate: inv, success: (r) => t(`status_${r.status}` as TKey) });
  const pct = f.latest_expected ? Math.round((100 * f.latest_sent) / f.latest_expected) : 0;
  return (
    <RCard className={cn("gap-5 p-6 shadow-[0_1px_2px_rgb(21_32_43/0.06),0_4px_12px_rgb(21_32_43/0.06)]", f.status === "archived" && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/forms/${f.id}/edit`} className="text-[17px] leading-snug font-bold text-r-ink no-underline hover:underline">{formTitle(f, lang)}</Link>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip><span className={cn("size-2 rounded-full", STATUS_DOT[f.status])} aria-hidden />{t(`status_${f.status}` as TKey)}</Chip>
            <Chip><Repeat aria-hidden />{t(`freq_${f.frequency}` as TKey)}</Chip>
            <Chip><CalendarDays aria-hidden />{rangeText(f.start_date, f.end_date ?? f.start_date, lang)}</Chip>
            <Chip><ListChecks aria-hidden /><span className="num">{f.fields_count}</span> {t("fields_n")}</Chip>
            <Chip><Users aria-hidden />{tf("n_offices", { n: f.recipients.length })}</Chip>
          </div>
        </div>
      </div>
      {f.status !== "draft" && f.latest_period && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-r-muted">{t("latest_responses")} · {dayMonth(f.latest_period, lang)}</span>
            <span className="num"><b className="text-lg">{fig(f.latest_sent)}</b> / {fig(f.latest_expected)}</span>
          </div>
          <div className="h-2 rounded bg-r-sunk" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-2 rounded bg-r-action" style={{ width: `${pct}%` }} />
          </div>
          {f.latest_deadline && <div className="text-xs text-r-muted">{tf("due_by", { when: whenText(f.latest_deadline, lang) })}</div>}
        </div>
      )}
      <div className="mt-auto flex flex-wrap gap-2">
        <RButton size="sm" variant="ghost" asChild><Link to={`/forms/${f.id}/edit`}><Pencil aria-hidden /> {t("edit")}</Link></RButton>
        {f.status !== "draft" && <RButton size="sm" variant="ghost" asChild><Link to={`/forms/responses${qs({ form: f.id })}`}><ClipboardCheck aria-hidden /> {t("nav_responses")}</Link></RButton>}
        <div className="ml-auto flex flex-wrap gap-1">
          {f.status === "draft" && (
            <RButton size="sm" variant="pri" loading={status.isPending} onClick={() => status.mutate("publish")}><Send aria-hidden /> {t("publish")}</RButton>
          )}
          {f.status === "archived" && <RButton size="sm" variant="ghost" loading={restore.isPending} onClick={() => restore.mutate(undefined)}>{t("restore")}</RButton>}
          {f.status === "published" && (
            <RButton size="icon" variant="ghost" aria-label={t("pause")} title={`${t("pause")}: ${t("pause_hint")}`} loading={status.isPending} onClick={() => status.mutate("pause")}><Pause aria-hidden /></RButton>
          )}
          {f.status === "paused" && (
            <RButton size="icon" variant="ghost" aria-label={t("resume")} title={t("resume")} loading={status.isPending} className="text-r-accepted hover:bg-r-accepted-soft" onClick={() => status.mutate("publish")}><Play aria-hidden /></RButton>
          )}
          {f.status !== "archived" && (
            <RButton size="icon" variant="ghost" aria-label={t("delete")} title={t("delete")} loading={del.isPending} className="text-r-overdue-ink hover:bg-r-overdue-soft"
              onClick={() => confirm(t("delete_confirm")) && del.mutate(undefined)}><Trash2 aria-hidden /></RButton>
          )}
        </div>
      </div>
    </RCard>
  );
}

/** One fact about a form in the card's meta row: icon + text, all the same size and weight. */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-r-line bg-r-ground px-2.5 text-[13px] font-semibold whitespace-nowrap text-r-ink [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-r-muted">
      {children}
    </span>
  );
}
