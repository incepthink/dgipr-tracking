import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, ClipboardCheck, FilePlus2, Pause, Pencil, Play, Send, Trash2, Users } from "lucide-react";
import { api, type FormBrief, type FormDef, type FormStatus } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import { useT, type TKey } from "@/lib/i18n";
import { cn, qs } from "@/lib/utils";
import { RButton, RCard, RCheck, RError, RPage, RTitle } from "@/components/reports/kit";
import { dayMonth, fig, rangeText, whenText } from "@/components/reports/period";
import { formTitle } from "./common";

const DOT: Record<FormStatus, string> = {
  draft: "border-2 border-dashed border-r-muted", published: "bg-r-accepted", paused: "bg-r-returned", archived: "border-2 border-r-faint",
};

export default function FormsListPage() {
  const { t } = useT();
  const nav = useNavigate();
  const [archived, setArchived] = React.useState(false);
  const { data, error, isLoading } = useQuery({
    queryKey: ["forms", { archived }], queryFn: () => api.get<FormBrief[]>(`/api/forms${archived ? "?archived=true" : ""}`),
  });
  return (
    <RPage>
      <RTitle title={t("forms_title")}
        actions={<>
          <RCheck checked={archived} onChange={setArchived} className="min-h-11 rounded-[10px]">{t("show_archived")}</RCheck>
          <RButton variant="pri" onClick={() => nav("/forms/new")}><FilePlus2 aria-hidden /> {t("new_form")}</RButton>
        </>} />
      {error ? <RError error={error} /> : isLoading || !data ? (
        <div className="grid gap-4 lg:grid-cols-2">{[0, 1].map((i) => <div key={i} className="h-48 animate-pulse rounded-2xl bg-r-sunk" />)}</div>
      ) : !data.length ? (
        <RCard className="items-start gap-3 p-6">
          <h2 className="disp m-0 text-[22px] font-bold">{t("no_forms")}</h2>
          <p className="m-0 text-r-muted">{t("no_forms_state")}</p>
          <RButton variant="pri" onClick={() => nav("/forms/new")}><FilePlus2 aria-hidden /> {t("new_form")}</RButton>
        </RCard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">{data.map((f) => <FormCard key={f.id} f={f} />)}</div>
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
    <RCard className={cn(f.status === "archived" && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/forms/${f.id}/edit`} className="text-[17px] font-bold text-r-ink no-underline hover:underline">{formTitle(f, lang)}</Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-r-muted">
            <span className={cn("size-2 rounded-full", DOT[f.status])} aria-hidden />
            <span className="font-bold text-r-ink">{t(`status_${f.status}` as TKey)}</span>
            · {t(`freq_${f.frequency}` as TKey)} · {rangeText(f.start_date, f.end_date ?? f.start_date, lang)}
            · {f.fields_count} {t("fields_n")} · <Users className="size-3" aria-hidden /> {f.recipients.length}
          </div>
        </div>
      </div>
      {f.status !== "draft" && f.latest_period && (
        <div>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-r-muted">{t("latest_responses")} · {dayMonth(f.latest_period, lang)}</span>
            <span className="num"><b className="text-lg">{fig(f.latest_sent)}</b> / {fig(f.latest_expected)}</span>
          </div>
          <div className="mt-1.5 h-2 rounded bg-r-sunk" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-2 rounded bg-r-action" style={{ width: `${pct}%` }} />
          </div>
          {f.latest_deadline && <div className="mt-1 text-xs text-r-muted">{tf("due_by", { when: whenText(f.latest_deadline, lang) })}</div>}
        </div>
      )}
      <div className="mt-auto flex flex-wrap gap-2">
        <RButton size="sm" variant="ghost" asChild><Link to={`/forms/${f.id}/edit`}><Pencil aria-hidden /> {t("edit")}</Link></RButton>
        {f.status !== "draft" && <RButton size="sm" variant="ghost" asChild><Link to={`/forms/responses${qs({ form: f.id })}`}><ClipboardCheck aria-hidden /> {t("nav_responses")}</Link></RButton>}
        {f.status !== "draft" && <RButton size="sm" variant="ghost" asChild><Link to={`/office/form-analytics${qs({ form: f.id })}`}><BarChart3 aria-hidden /> {t("nav_analytics")}</Link></RButton>}
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
