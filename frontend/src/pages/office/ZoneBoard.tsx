import * as React from "react";
import { useQueries } from "@tanstack/react-query";
import { ChevronDown, FileSpreadsheet } from "lucide-react";
import { api, backendUrl, type FormDef, type FormField, type ResponseRow, type ResponsesData } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, qs } from "@/lib/utils";
import { RButton, RError, RPage, RSearch, StatusMark, markOf } from "@/components/reports/kit";
import { deadlineOf, durationText, fig, isOverdue, longDay, periodOf, rangeText, sameIstDay, timeOf, whenText } from "@/components/reports/period";
import { fieldLabel, formTitle, useFormFilters } from "../forms/common";
import { allRange, DatePicker, officeName, shortOffice, showValue, startedForms } from "../forms/Responses";
import { periodName, useResponses } from "./shared";

const SENT = ["submitted", "returned"];
const isSent = (r: ResponseRow) => SENT.includes(r.status);
const norm = (s: string) => s.toLocaleLowerCase().trim();

const FILTERS = ["all", "waiting", "done"] as const;
type Filter = (typeof FILTERS)[number];

/** Zone officer's home: every form, each a dropdown showing how each district in the zone stands across its dates. Read-only. */
export default function ZoneBoardPage() {
  const { t, tf, lang } = useT();
  const me = useUser();
  const f = useFormFilters();
  const today = f.today;
  const q = f.params.get("q") || "";
  const filter: Filter = FILTERS.find((k) => k === f.params.get("show")) ?? "all";
  const forms = React.useMemo(() => (f.forms && today ? startedForms(f.forms, today) : []), [f.forms, today]);

  // one responses query per form over all its dates (same key as the dropdown's useResponses, so the cache is shared)
  const results = useQueries({
    queries: forms.map((x) => {
      const { start, end } = allRange(x, today);
      const key = qs({ start, end, division: "" });
      return {
        queryKey: ["responses", x.id, key], placeholderData: (p: ResponsesData | undefined) => p,
        queryFn: () => api.get<ResponsesData>(`/api/forms/${x.id}/responses${key}`),
      };
    }),
  });
  const rowsOf = (i: number) => results[i]?.data?.rows ?? [];
  const waiting = (i: number) => rowsOf(i).some((r) => !isSent(r));
  const inFilter = (i: number, k: Filter) => k === "all" || (!!results[i]?.data && (k === "waiting" ? waiting(i) : !waiting(i)));
  const counts = Object.fromEntries(FILTERS.map((k) => [k, forms.filter((_, i) => inFilter(i, k)).length])) as Record<Filter, number>;

  // a form whose title matches shows every district; otherwise only the matching districts
  const needle = norm(q);
  const matcher = (x: FormDef) => (rows: ResponseRow[]) => !needle || norm(x.title_mr).includes(needle) || norm(x.title_en).includes(needle)
    ? rows : rows.filter((r) => [r.office_name_mr, r.office_name_en, r.office].some((s) => norm(s ?? "").includes(needle)));
  const shown = forms.map((x, i) => ({ x, i }))
    .filter(({ x, i }) => inFilter(i, filter) && (!needle || !results[i]?.data || matcher(x)(rowsOf(i)).length > 0));

  // sections opened by hand; while searching (or with a single form) sections start open unless closed by hand
  const [opened, setOpened] = React.useState<Set<number>>(new Set());
  const [closed, setClosed] = React.useState<Set<number>>(new Set());
  React.useEffect(() => setClosed(new Set()), [q]);
  const openByDefault = !!needle || forms.length === 1;
  const isOpen = (id: number) => (openByDefault ? !closed.has(id) : opened.has(id));
  const toggle = (id: number) => {
    const flip = (s: Set<number>) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; };
    if (openByDefault) setClosed(flip); else setOpened(flip);
  };

  return (
    <RPage className="gap-4">
      <header className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] font-bold tracking-[0.06em] text-r-muted uppercase">{f.today ? longDay(f.today, lang) : ""}</span>
        <h1 className="disp m-0 text-[28px] leading-[1.1] font-bold">{t("zone_officer")}: {me.division?.label_mr ?? me.display_name}</h1>
        <span className="text-sm text-r-muted">{t("zb_sub")}</span>
      </header>

      <RSearch value={q} placeholder={t("zb_search")} onChange={(v) => f.set({ q: v || null })} />
      <div role="group" aria-label={t("zb_filter")} className="flex flex-wrap gap-2">
        {FILTERS.map((k) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => f.set({ show: k === "all" ? null : k })}
            className={cn("inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-4 text-sm font-bold",
              filter === k ? "border-r-ink bg-r-ink text-r-card" : "border-r-line bg-r-card text-r-ink hover:bg-r-sunk")}>
            {t(`zb_f_${k}`)}
            <span className={cn("num min-w-6 rounded-full px-1.5 py-px text-center text-xs", filter === k ? "bg-r-card text-r-ink" : "bg-r-sunk text-r-muted")}>{counts[k]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {!f.forms ? <div className="h-40 animate-pulse rounded-2xl bg-r-sunk" />
          : !forms.length ? <p className="m-0 rounded-2xl bg-r-card p-5 text-r-muted">{t("no_forms")}</p>
          : shown.map(({ x }) => (
            <FormRow key={x.id} form={x} today={today} match={matcher(x)} open={isOpen(x.id)} onToggle={() => toggle(x.id)} />
          ))}
        {forms.length > 0 && !shown.length && (
          <p className="m-0 rounded-2xl bg-r-card p-5 text-r-muted">{needle ? tf("resp_no_match", { q: q.trim() }) : t("mine_none_in_filter")}</p>
        )}
      </div>
    </RPage>
  );
}

// --------------------------------------------------------------------------- one form, as a dropdown
/** All dates by default; the calendar narrows the dropdown to one date. */
function FormRow({ form, today, match, open, onToggle }: {
  form: FormDef; today: string; match: (rows: ResponseRow[]) => ResponseRow[]; open: boolean; onToggle: () => void;
}) {
  const { t, tf, lang } = useT();
  const now = Date.now();
  const [sel, setSel] = React.useState<string | null>(null);
  const range = allRange(form, today);
  const once = form.frequency === "once";
  const all = !sel && !once;
  const ps = periodOf(form, sel ?? range.end);
  const { start, end } = all ? range : { start: ps, end: ps };
  const { data, error, isFetching } = useResponses(form.id, start, end);
  const fields = (data?.form.fields ?? []).filter((x) => !x.archived);
  const every = React.useMemo(() => (data?.rows ?? []).filter((r) => r.period_start >= start && r.period_start <= end), [data, start, end]);
  const rows = match(every);
  const sent = every.filter(isSent).length;
  const left = every.length - sent;
  const pct = every.length ? Math.round((100 * sent) / every.length) : 0;
  const dl = all ? null : deadlineOf(form, ps);
  const past = !!dl && dl.getTime() <= now;
  const dueLine = !dl ? "" : !past
    ? `${sameIstDay(dl, new Date(now)) ? tf("due_today_by", { time: timeOf(dl, lang) }) : tf("due_by", { when: whenText(dl, lang) })} · ${tf("time_left", { d: durationText(dl.getTime() - now, lang) })}`
    : tf("was_due_short", { when: whenText(dl, lang) });
  const bodyId = `zb-${form.id}`;

  return (
    <section className="rounded-2xl border border-r-line bg-r-card">
      <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}
        className={cn("flex w-full cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 border-0 bg-transparent px-5 py-4",
          open ? "rounded-t-2xl" : "rounded-2xl", "text-left text-r-ink hover:bg-r-ground")}>
        <span className="flex min-w-0 flex-[1_1_260px] items-center gap-3">
          <ChevronDown className={cn("size-5 shrink-0 text-r-muted transition-transform", !open && "-rotate-90")} aria-hidden />
          <span className="flex min-w-0 flex-col">
            <b className="text-[17px] wrap-break-word">{formTitle(form, lang)}</b>
            <span className={cn("text-[13px]", past && left ? "font-semibold text-r-overdue-ink" : "text-r-muted")}>
              {all ? `${t("zb_all_dates")} · ${rangeText(start, end, lang)}` : periodName(form, ps, lang)}{dueLine && ` · ${dueLine}`}
            </span>
          </span>
        </span>
        {data && (
          <span className="ml-8 flex w-full max-w-60 shrink-0 flex-col gap-1.5 sm:ml-auto sm:w-60">
            <span className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="num"><b className="text-[15px]">{sent}</b>/{every.length} {t("zb_sent_word")}</span>
              {left ? <b className={past ? "text-r-overdue-ink" : "text-r-muted"}>{tf("zb_n_left", { n: left })}</b>
                : <b className="text-r-accepted">{t("zb_f_done")}</b>}
            </span>
            <span className="h-2 overflow-hidden rounded bg-r-sunk" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("zb_sent_word")}>
              <span className={cn("block h-2 rounded", left ? "bg-r-action" : "bg-r-accepted")} style={{ width: `${pct}%` }} />
            </span>
          </span>
        )}
      </button>

      {open && (
        <div id={bodyId} className="flex flex-col gap-3 border-t border-r-line p-4">
          <div className="flex flex-wrap items-center gap-2">
            {!once && (
              <>
                <button type="button" aria-pressed={all} onClick={() => setSel(null)}
                  className={cn("inline-flex h-11.75 cursor-pointer items-center rounded-xl border-[1.5px] px-4 text-[15px] font-semibold",
                    all ? "border-r-ink bg-r-ink text-r-card" : "border-r-line bg-r-card text-r-ink hover:bg-r-sunk")}>
                  {t("zb_all_dates")}
                </button>
                <span className={cn("rounded-xl border-[1.5px]", !all ? "border-r-ink" : "border-r-line")}>
                  <DatePicker iconOnly align="left" value={sel ?? range.end} max={today} min={form.start_date} last={form.end_date ?? undefined} onChange={setSel} />
                </span>
              </>
            )}
            <RButton asChild size="sm" variant="ghost" className="ml-auto">
              <a href={backendUrl(`/api/forms/${form.id}/export?start=${start}&end=${end}`)} download><FileSpreadsheet aria-hidden /> {t("export_workbook")}</a>
            </RButton>
          </div>
          {error ? <RError error={error} /> : !data ? <div className="h-40 animate-pulse rounded-xl bg-r-sunk" /> : !rows.length ? (
            <p className="m-0 text-r-muted">{t("resp_no_rows")}</p>
          ) : (
            <DistrictTable form={form} rows={rows} fields={fields} byDate={all} dim={isFetching} now={now} />
          )}
        </div>
      )}
    </section>
  );
}

// --------------------------------------------------------------------------- districts × figures
/** Fixed layout so every field fits the width on desktop; with `byDate`, newest period first, each under its own band. */
function DistrictTable({ form, rows, fields, byDate, dim, now }: {
  form: FormDef; rows: ResponseRow[]; fields: FormField[]; byDate: boolean; dim: boolean; now: number;
}) {
  const { t, tf, lang } = useT();
  const sums = fields.filter((x) => x.type === "number" && x.aggregate === "sum");
  const total = (list: ResponseRow[], k: string) => list.filter(isSent).reduce((n, r) => n + (Number(r.values[k]) || 0), 0);
  const groups = React.useMemo(() => {
    if (!byDate) return [{ ps: "", rows }];
    const m = new Map<string, ResponseRow[]>();
    rows.forEach((r) => m.set(r.period_start, [...(m.get(r.period_start) ?? []), r]));
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([ps, rs]) => ({ ps, rows: rs }));
  }, [rows, byDate]);
  const cols = fields.length + 2;
  const th = "border-b border-r-line bg-r-card px-1.5 py-2 align-bottom text-xs font-bold text-r-muted";
  const td = "border-b border-r-line-soft px-1.5 py-1.5";

  return (
    <div className={cn("max-h-[75vh] overflow-auto rounded-xl border border-r-line-soft scrollbar-thin transition-opacity", dim && "opacity-60")}>
      <table className="w-full min-w-180 table-fixed border-separate border-spacing-0 text-[13px] lg:min-w-0">
        <colgroup>
          <col className="w-32 xl:w-40" />
          <col className="w-28 xl:w-36" />
          {fields.map((x) => <col key={x.key} />)}
        </colgroup>
        <thead className="sticky top-0 z-20">
          <tr>
            <th scope="col" className={cn(th, "sticky left-0 z-30 text-left")}>{t("zb_district")}</th>
            <th scope="col" className={cn(th, "text-left")}>{t("status")}</th>
            {fields.map((x) => (
              <th key={x.key} scope="col" title={fieldLabel(x, lang)} className={cn(th, "text-right text-[11px] leading-tight wrap-break-word hyphens-auto")}>{fieldLabel(x, lang)}</th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.ps || "one"}>
            {byDate && (
              <tr>
                <th scope="colgroup" colSpan={cols} className="sticky left-0 border-b border-r-line bg-r-sunk px-2 py-1.5 text-left text-[13px]">
                  <span className="font-bold">{periodName(form, g.ps, lang)}</span>
                  <span className="num ml-2 font-normal text-r-muted">{tf("zb_n_of_m_sent", { a: g.rows.filter(isSent).length, b: g.rows.length })}</span>
                </th>
              </tr>
            )}
            {g.rows.map((r) => {
              const sent = isSent(r);
              return (
                <tr key={r.office + r.period_start} className="hover:bg-r-ground">
                  <th scope="row" className={cn(td, "sticky left-0 z-10 truncate bg-r-card text-left font-semibold")}>
                    <span title={officeName(r, lang)}>{shortOffice(r, lang)}</span>
                  </th>
                  <td className={cn(td, "truncate")}><StatusCell form={form} r={r} now={now} /></td>
                  {fields.map((x) => (
                    <td key={x.key} className={cn(td, "num truncate text-right", !sent && "text-r-faint")}>
                      {sent ? <span className={r.corrections[x.key] ? "corr" : undefined}>{showValue(x, r.values[x.key], t)}</span> : "—"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        ))}
        {sums.length > 0 && rows.length > 1 && (
          <tfoot className="sticky bottom-0 z-20">
            <tr>
              <th scope="row" className="sticky left-0 z-30 truncate border-t-[1.5px] border-r-ink bg-r-sunk px-1.5 py-2 text-left font-bold">
                {byDate ? t("zb_zone_total_all") : t("zb_zone_total")}
              </th>
              <td className="truncate border-t-[1.5px] border-r-ink bg-r-sunk px-1.5 py-2 text-xs text-r-muted">{t("zb_sent_only")}</td>
              {fields.map((x) => (
                <td key={x.key} className="num truncate border-t-[1.5px] border-r-ink bg-r-sunk px-1.5 py-2 text-right font-bold">
                  {sums.includes(x) ? fig(total(rows, x.key)) : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** One plain word per district: sent at what time, accepted, returned, draft, not sent, overdue. */
function StatusCell({ form, r, now }: { form: FormDef; r: ResponseRow; now: number }) {
  const { t, tf, lang } = useT();
  const over = isOverdue(r.status, deadlineOf(form, r.period_start), now);
  const at = r.submitted_at ? (r.submitted_at.slice(0, 10) <= r.period_end ? timeOf(r.submitted_at, lang) : whenText(r.submitted_at, lang)) : "";
  const word = r.status === "submitted" ? (at ? tf("zb_sent_at", { time: at }) : t("sub_submitted"))
    : r.status === "returned" ? t("zb_returned")
    : over ? t("overdue")
    : r.status === "draft" ? t("draft_not_sent") : t("sub_none");
  const tone = r.status === "submitted" ? "text-r-ink" : r.status === "returned" || over ? "font-semibold text-r-overdue-ink" : "text-r-muted";
  const full = `${word}${r.late && isSent(r) ? ` · ${t("late")}` : ""}`;
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5", tone)} title={r.status === "returned" && r.review_note ? `${full}: ${r.review_note}` : full}>
      <StatusMark mark={markOf(r.status, over)} late={r.late} className="shrink-0" />
      <span className="truncate">{full}</span>
    </span>
  );
}
