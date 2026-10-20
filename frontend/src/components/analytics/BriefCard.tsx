import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Sparkles } from "lucide-react";
import { api, type Brief } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { qs } from "@/lib/utils";
import { RButton, RChip } from "@/components/reports/kit";
import { dayMonth } from "@/components/reports/period";
import { CopyButton } from "@/pages/office/shared";

/** The daily brief: model-worded when configured (every number filled in by code), otherwise the template. */
export function BriefCard({ formId, division, enabled }: { formId: number; division: string; enabled: boolean }) {
  const { t, lang } = useT();
  const me = useUser();
  const qc = useQueryClient();
  const key = ["analytics", formId, "brief", division, lang];
  const q = useQuery({
    queryKey: key, enabled: enabled && !!formId, staleTime: 10 * 60_000,
    queryFn: () => api.get<Brief>(`/api/forms/${formId}/analytics/brief${qs({ lang, division })}`),
  });
  const refresh = useMutation({
    mutationFn: () => api.get<Brief>(`/api/forms/${formId}/analytics/brief${qs({ lang, division, refresh: "true" })}`),
    onSuccess: (b) => qc.setQueryData(key, b),
  });
  const b = q.data;
  if (q.isError || (b && b.source === "none")) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border-[1.5px] border-r-line bg-r-action-soft p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-r-action" aria-hidden />
        <b className="text-sm">{t("brief_title")}</b>
        {b?.period && <span className="text-[13px] text-r-muted">{dayMonth(b.period, lang)}</span>}
        {b && <RChip className="ml-auto" title={b.source === "template" && b.reason ? b.reason : undefined}>{b.source === "ai" ? t("brief_ai") : t("brief_template")}</RChip>}
      </div>
      {!b ? <div className="h-16 animate-pulse rounded-lg bg-r-sunk" /> : <p className="m-0 leading-relaxed">{b.text}</p>}
      {b && (
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={b.text} label={t("brief_copy")} done={t("copied")} />
          {me.role === "state" && b.ai_configured && (
            <RButton size="sm" loading={refresh.isPending} onClick={() => refresh.mutate()}><RefreshCw aria-hidden /> {t("brief_refresh")}</RButton>
          )}
          <span className="text-xs text-r-muted">{b.source === "ai" ? t("brief_ai_note") : b.ai_configured ? t("brief_fallback_note") : t("brief_no_ai_note")}</span>
        </div>
      )}
    </div>
  );
}
