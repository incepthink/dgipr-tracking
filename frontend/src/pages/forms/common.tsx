import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type FormDef, type FormField, type SubStatus } from "@/lib/api";
import { useMeta } from "@/lib/hooks";
import { useUser } from "@/lib/auth";
import { useT, type TKey } from "@/lib/i18n";
import { addDays, cn, dmy } from "@/lib/utils";
import { Badge, Card, Field, Select } from "@/components/ui/primitives";
import { DateInput } from "@/components/reports/DateInput";
import { Button } from "@/components/ui/button";

/** Forms the user can see (state: all but archived; others: live/paused forms sent to their offices). */
export function useForms() {
  return useQuery({ queryKey: ["forms"], queryFn: () => api.get<FormDef[]>("/api/forms"), staleTime: 30_000 });
}

export function useFormDef(id: number | null | undefined) {
  return useQuery({ queryKey: ["form", id], enabled: !!id, queryFn: () => api.get<FormDef>(`/api/forms/${id}`) });
}

/** Today in Asia/Kolkata (the server's default_day is yesterday). */
export function useToday() {
  const { data: meta } = useMeta();
  return meta ? addDays(meta.default_day, 1) : "";
}

/** Numeric fields totalled in reports: the roll-up columns. */
export function sumColumns(form: FormDef | undefined): FormField[] {
  return (form?.fields ?? []).filter((f) => f.type === "number" && f.aggregate === "sum" && !f.archived);
}

export function formTitle(f: { title_mr: string; title_en: string } | undefined, lang: string) {
  return !f ? "" : lang === "en" && f.title_en ? f.title_en : f.title_mr;
}

export function fieldLabel(f: { label_mr: string; label_en: string }, lang: string) {
  return lang === "en" && f.label_en ? f.label_en : f.label_mr;
}

/** Form, period and division for the analytics / reports / responses pages, kept in the URL. */
export function useFormFilters(defaultDays = 7) {
  const [params, setParams] = useSearchParams();
  const { data: forms } = useForms();
  const today = useToday();
  const live = forms?.filter((f) => f.status !== "draft") ?? [];
  const formId = Number(params.get("form")) || live[0]?.id || forms?.[0]?.id || 0;
  const { data: form } = useFormDef(formId);
  const lastDay = form?.end_date && form.end_date < today ? form.end_date : today;
  const end = params.get("end") || lastDay;
  const start = params.get("start") || (end ? maxDate(addDays(end, -(defaultDays - 1)), form?.start_date ?? "") : "");
  const division = params.get("division") || "";
  const office = params.get("office") || "";
  const set = React.useCallback((patch: Record<string, string | number | null | undefined>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === "") next.delete(k);
        else next.set(k, String(v));
      }
      return next;
    }, { replace: true });
  }, [setParams]);
  return { forms, form, formId, start, end, lastDay, division, office, today, ready: !!form && !!today, set, params };
}

export type FormFilters = ReturnType<typeof useFormFilters>;

function maxDate(a: string, b: string) {
  return a > b ? a : b;
}

export function scopeQs(f: FormFilters, extra: Record<string, string | number | undefined> = {}) {
  const p = new URLSearchParams({ start: f.start, end: f.end });
  if (f.division) p.set("division", f.division);
  if (f.office) p.set("office", f.office);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") p.set(k, String(v));
  return "?" + p.toString();
}

export function FormSelect({ f }: { f: FormFilters }) {
  const { t, lang } = useT();
  if (!f.forms?.length) return null;
  return (
    <Field label={t("form")} className="min-w-56 flex-1 sm:flex-none">
      <Select value={f.formId} onChange={(e) => f.set({ form: e.target.value, start: null, end: null })}>
        {f.forms.map((x) => <option key={x.id} value={x.id}>{formTitle(x, lang)}{x.status === "draft" ? ` (${t("status_draft")})` : ""}</option>)}
      </Select>
    </Field>
  );
}

export function DivisionSelect({ f }: { f: FormFilters }) {
  const me = useUser();
  const { data: meta } = useMeta();
  const { t } = useT();
  if (me.role !== "state") return null;
  return (
    <Field label={t("division")}>
      <Select value={f.division} onChange={(e) => f.set({ division: e.target.value })}>
        <option value="">{t("all_divisions")}</option>
        {meta?.divisions.map((d) => <option key={d.code} value={d.code}>{d.label_mr}</option>)}
      </Select>
    </Field>
  );
}

/** One filter row above everything it scopes: form, period (with presets), division. */
export function FilterBar({ f, single, extra }: { f: FormFilters; single?: boolean; extra?: React.ReactNode }) {
  const { t } = useT();
  const last = f.lastDay;
  const presets = single ? [
    { label: t("today"), s: f.today, e: f.today },
    { label: t("yesterday"), s: addDays(f.today, -1), e: addDays(f.today, -1) },
  ] : [
    { label: t("last7"), s: addDays(last, -6), e: last },
    { label: t("last30"), s: addDays(last, -29), e: last },
    ...(f.form ? [{ label: t("campaign_all"), s: f.form.start_date, e: last }] : []),
  ];
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <FormSelect f={f} />
        {single ? (
          <Field label={t("date")}>
            <DateInput look="plain" value={f.end} max={f.lastDay} onChange={(d) => d && f.set({ start: d, end: d })} />
          </Field>
        ) : (
          <>
            <Field label={t("from")}>
              <DateInput look="plain" value={f.start} max={f.end} onChange={(d) => d && f.set({ start: d, end: d > f.end ? d : f.end })} />
            </Field>
            <Field label={t("to")}>
              <DateInput look="plain" value={f.end} min={f.start} max={f.lastDay} onChange={(d) => d && f.set({ end: d })} />
            </Field>
          </>
        )}
        <div className="flex flex-wrap gap-1.5 pb-0.5">
          {presets.map((p) => {
            const active = p.e === f.end && (single || p.s === f.start);
            return (
              <Button key={p.label} size="sm" variant={active ? "secondary" : "ghost"} className={cn(active && "ring-1 ring-primary/30")}
                onClick={() => f.set({ start: p.s, end: p.e })}>{p.label}</Button>
            );
          })}
        </div>
        <DivisionSelect f={f} />
        {extra && <div className="ml-auto flex flex-wrap items-end gap-3">{extra}</div>}
      </div>
    </Card>
  );
}

/** Day label like "बुध, 15/10/2026" / "Wed, 15/10/2026". */
export function dayLabel(iso: string, lang: string) {
  const d = new Date(iso + "T00:00:00");
  return `${d.toLocaleDateString(lang === "mr" ? "mr-IN" : "en-IN", { weekday: "short" })}, ${dmy(iso)}`;
}

export function periodText(p: { period_start: string; period_end: string }, lang: string) {
  return p.period_start === p.period_end ? dayLabel(p.period_start, lang)
    : `${dayLabel(p.period_start, lang)} – ${dayLabel(p.period_end, lang)}`;
}

export const SUB_TONE: Record<SubStatus, "neutral" | "warning" | "info" | "danger" | "success"> = {
  none: "neutral", draft: "warning", submitted: "info", returned: "danger",
};

/** Cell colours for the compliance matrix (tokens shared with the analytics heatmap). */
export const SUB_FILL: Record<SubStatus, string> = {
  none: "var(--seq-empty)", draft: "var(--seq-partial)", submitted: "var(--seq-full)", returned: "var(--danger)",
};

export function SubBadge({ status, late }: { status: SubStatus; late?: boolean }) {
  const { t } = useT();
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={SUB_TONE[status]} dot>{t(`sub_${status}` as TKey)}</Badge>
      {late && <Badge tone="danger">{t("late")}</Badge>}
    </span>
  );
}

export function fmtInstant(iso: string | null | undefined, lang: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${dmy(d)}, ${d.toLocaleTimeString(lang === "mr" ? "mr-IN" : "en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}`;
}
