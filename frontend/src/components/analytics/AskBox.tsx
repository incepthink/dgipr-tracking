import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { api, type AskAnswer, type AskSuggestion } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RButton, RCard, RCardTitle, RInput } from "@/components/reports/kit";
import { dayMonth, fig, rangeText } from "@/components/reports/period";
import { Sparkline } from "./Sparkline";

/**
 * विचारा: a question becomes one of a fixed set of queries (the model only chooses which, and with what), run
 * under the asker's own access. Suggested questions run without the model. The answer is always a table or a
 * day-by-day series computed by the server.
 */
export function AskBox({ formId, scope }: { formId: number; scope: string }) {
  const { t, lang } = useT();
  const [q, setQ] = React.useState("");
  const sugg = useQuery({
    queryKey: ["analytics", formId, "ask-suggestions", scope], enabled: !!formId,
    queryFn: () => api.get<{ ai_configured: boolean; suggestions: AskSuggestion[] }>(`/api/forms/${formId}/analytics/ask${scope}`),
  });
  const ask = useMutation({
    mutationFn: (body: { question?: string; intent?: string; params?: Record<string, unknown> }) =>
      api.post<AskAnswer>(`/api/forms/${formId}/analytics/ask${scope}`, body),
  });
  const a = ask.data;
  const aiOn = sugg.data?.ai_configured;
  return (
    <RCard className="gap-3">
      <RCardTitle>{t("ask_title")}</RCardTitle>
      {aiOn ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask.mutate({ question: q.trim() }); }}>
          <RInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ask_placeholder")} aria-label={t("ask_title")} className="flex-1" maxLength={500} />
          <RButton type="submit" variant="pri" loading={ask.isPending} disabled={!q.trim()}><Send aria-hidden /> {t("ask_go")}</RButton>
        </form>
      ) : <p className="m-0 text-sm text-r-muted">{t("ask_no_ai")}</p>}
      <div className="flex flex-wrap gap-1.5">
        {(sugg.data?.suggestions ?? []).map((s) => (
          <button key={s.en} type="button" onClick={() => { setQ(lang === "en" ? s.en : s.mr); ask.mutate({ intent: s.intent, params: s.params }); }}
            className="cursor-pointer rounded-full border-[1.5px] border-r-line bg-r-card px-3 py-1 text-[13px] font-bold text-r-ink hover:border-r-action">
            {lang === "en" ? s.en : s.mr}
          </button>
        ))}
      </div>
      {ask.isError && <p className="m-0 text-sm text-r-overdue-ink">{(ask.error as Error).message}</p>}
      {a && <Answer a={a} />}
    </RCard>
  );
}

function Answer({ a }: { a: AskAnswer }) {
  const { t, tf, lang } = useT();
  if (a.intent === "unsupported") {
    return <p className="m-0 rounded-xl bg-r-ground p-3 text-r-muted">{t("ask_unsupported")}</p>;
  }
  const range = a.start && a.end ? rangeText(a.start, a.end, lang) : "";
  const cell = (v: string | number | null | undefined, num: boolean) =>
    v === null || v === undefined ? <span className="text-r-faint">—</span> : num && typeof v === "number" ? fig(v) : String(v);
  return (
    <div className="flex flex-col gap-2 rounded-xl border-[1.5px] border-r-line p-3">
      <span className="text-[13px] text-r-muted">
        {range}{a.summary && <> · {tf("ask_sent_of", { a: a.summary.sent, b: a.summary.offices })}</>}
      </span>
      {a.kind === "series" && a.points ? (
        <div className="flex flex-col gap-2">
          <Sparkline values={a.points.map((p) => (p.reported ? p.value : null))} width={320} height={60} className="max-w-full"
            label={a.points.map((p) => `${dayMonth(p.date, lang)} ${p.reported ? fig(p.value) : "—"}`).join(", ")} />
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-r-muted">
            {a.points.map((p) => <span key={p.date} className="num">{dayMonth(p.date, lang)}: <b className="text-r-ink">{p.reported ? fig(p.value) : "—"}</b></span>)}
          </div>
        </div>
      ) : !a.rows?.length ? <span className="text-r-muted">{t("ask_empty")}</span> : (
        <div className="max-h-[50vh] overflow-auto scrollbar-thin">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>{a.columns?.map((c) => <th key={c.key} className={cn("border-b border-r-line px-2 py-1.5 text-xs font-bold text-r-muted", c.num ? "text-right" : "text-left")}>{lang === "en" ? c.label_en : c.label_mr}</th>)}</tr>
            </thead>
            <tbody>
              {a.rows.map((r, i) => (
                <tr key={i}>
                  {a.columns?.map((c) => (
                    <td key={c.key} className={cn("border-b border-r-line-soft px-2 py-1.5", c.num ? "num text-right" : "")}>
                      {c.key === "name" ? (lang === "en" && r.name_en ? r.name_en : r.name_mr) : cell(r[c.key], c.num)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
