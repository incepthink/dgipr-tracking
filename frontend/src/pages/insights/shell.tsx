import * as React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useT, type TKey } from "@/lib/i18n";
import { addDays, cn } from "@/lib/utils";
import { RFilterBar, RLabel, RSelect } from "@/components/reports/kit";
import { DateInput } from "@/components/reports/DateInput";
import { scopeQs, type FormFilters } from "../forms/common";
import { DivisionPicker, FormPicker } from "../office/shared";

/* The four Analytics tabs (Overview, Form analytics, Districts, Posts) share one tab bar and one set of filters —
   form, dates, division — kept in the URL, so switching tabs keeps what was picked. Everything is real data from the
   report forms (app/forms/insights.py, analytics.py); nothing is collected from the platforms. */

const TABS: { to: string; label: TKey; end?: boolean }[] = [
  { to: "/insights", label: "ins_overview", end: true },
  { to: "/office/form-analytics", label: "nav_form_analytics" },
  { to: "/insights/districts", label: "ins_districts" },
  { to: "/insights/posts", label: "ins_posts" },
];

/** Big, always-visible tabs (phones included); they carry the current filters along. */
export function AnalyticsTabs() {
  const { t } = useT();
  const { search } = useLocation();
  // only the shared filters travel between tabs
  const keep = new URLSearchParams(search);
  const carry = new URLSearchParams();
  ["form", "start", "end", "division"].forEach((k) => { const v = keep.get(k); if (v) carry.set(k, v); });
  const q = carry.size ? `?${carry}` : "";
  return (
    <nav aria-label={t("nav_analytics")} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin">
      {TABS.map((x) => (
        <NavLink key={x.to} to={x.to + q} end={x.end}
          className={({ isActive }) => cn("flex min-h-11 shrink-0 items-center rounded-full border-[1.5px] px-4 text-[15px] font-bold no-underline",
            isActive ? "border-r-ink bg-r-ink text-r-card" : "border-r-line bg-r-card text-r-ink hover:border-r-action")}>
          {t(x.label)}
        </NavLink>
      ))}
    </nav>
  );
}

/** Form, a dates preset (last 7 / 14 / 30 days, whole form, custom) and, for the state office, the division. */
export function AnalyticsFilters({ f, note }: { f: FormFilters; note?: React.ReactNode }) {
  const { t } = useT();
  const span = !f.form ? "7" : f.start === f.form.start_date && f.end === f.lastDay ? "all"
    : f.end === f.lastDay && f.start === addDays(f.lastDay, -6) ? "7" : f.end === f.lastDay && f.start === addDays(f.lastDay, -13) ? "14"
    : f.end === f.lastDay && f.start === addDays(f.lastDay, -29) ? "30" : "custom";
  const [custom, setCustom] = React.useState(false);
  const setSpan = (v: string) => {
    if (v === "custom") { setCustom(true); return; }
    setCustom(false);
    const days = { "7": 6, "14": 13, "30": 29 }[v];
    const st = v === "all" || !days ? f.form?.start_date : addDays(f.lastDay, -days);
    f.set({ start: st && f.form && st < f.form.start_date ? f.form.start_date : st, end: f.lastDay });
  };
  return (
    <RFilterBar>
      <FormPicker f={f} />
      <RLabel small label={t("dates")}>
        <RSelect value={custom ? "custom" : span} onChange={(e) => setSpan(e.target.value)}>
          <option value="7">{t("last7")}</option>
          <option value="14">{t("days14")}</option>
          <option value="30">{t("last30")}</option>
          <option value="all">{t("whole_form")}</option>
          <option value="custom">{t("custom_range")}</option>
        </RSelect>
      </RLabel>
      {(custom || span === "custom") && (
        <>
          <RLabel small label={t("from")}><DateInput value={f.start} min={f.form?.start_date} max={f.end} onChange={(d) => d && f.set({ start: d })} /></RLabel>
          <RLabel small label={t("to")}><DateInput value={f.end} min={f.start} max={f.lastDay} onChange={(d) => d && f.set({ end: d })} /></RLabel>
        </>
      )}
      <DivisionPicker f={f} />
      {note && <span className="pb-2 text-[13px] text-r-muted">{note}</span>}
    </RFilterBar>
  );
}

/** One analytics endpoint for the picked form, dates and division. */
export function useAnalytics<T>(f: FormFilters, path: string, extra: Record<string, string | number | undefined> = {}, enabled = true) {
  const q = scopeQs(f, extra);
  return useQuery({
    queryKey: ["analytics", f.formId, path, q], enabled: f.ready && enabled, placeholderData: (p) => p,
    queryFn: () => api.get<T>(`/api/forms/${f.formId}/analytics/${path}${q}`),
  });
}

/** A loading block of the right size. */
export function Pending({ h = "h-40" }: { h?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-r-sunk", h)} />;
}
