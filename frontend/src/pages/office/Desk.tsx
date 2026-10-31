import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { FileSpreadsheet, Megaphone, Search, X } from "lucide-react";
import { backendUrl, type CampaignBrief, type FormDef, type FormField, type ResponseRow } from "@/lib/api";
import { useMeta } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { cn, qs } from "@/lib/utils";
import { RButton, RCard, RError, StatusMark, markOf } from "@/components/reports/kit";
import { deadlineOf, isOverdue, timeOf, whenText } from "@/components/reports/period";
import { fieldLabel, formTitle, sumColumns, useFormFilters } from "../forms/common";
import { cellInfo, chaseText, CopyButton, periodName, reportingPeriod, useCompliance, useResponses, windowOf } from "./shared";

/** A flag worth a second look before accepting: far above the office's own recent average, or zeros. */
/** Same rule as app/forms/insights.py spike_of (docs/analytics.md), so the Desk and Analytics flag the same rows:
 * value ≥ 3 × the office's median over its last 14 reported periods, and at least 10 above it (≥ 3 periods of history). */
export function anomalyOf(row: ResponseRow, history: ResponseRow[], cols: FormField[]) {
  let best: { field: FormField; ratio: number; avg: number; v: number } | null = null;
  for (const c of cols) {
    const v = row.values[c.key];
    if (typeof v !== "number") continue;
    const past = history.filter((h) => h.office === row.office && h.period_start < row.period_start && ["submitted", "returned"].includes(h.status))
      .sort((a, b) => a.period_start.localeCompare(b.period_start))
      .map((h) => h.values[c.key]).filter((x): x is number => typeof x === "number").slice(-14);
    if (past.length < 3) continue;
    const usual = median(past);
    const ratio = usual ? v / usual : Infinity;
    if (v >= 3 * usual && v - usual >= 10 && (!best || ratio > best.ratio)) best = { field: c, ratio, avg: usual, v };
  }
  return best;
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function zerosOf(row: ResponseRow, cols: FormField[]) {
  return cols.filter((c) => row.values[c.key] === 0).length;
}

const isSent = (s: string) => s === "submitted" || s === "returned";

type Filter = "all" | "none" | "submitted" | "returned";

// --------------------------------------------------------------------------- search
type Hit = { kind: "form"; form: FormDef } | { kind: "campaign"; c: CampaignBrief };

function DeskSearch({ forms, campaigns, current, onForm }: {
  forms: FormDef[]; campaigns: CampaignBrief[]; current: number; onForm: (id: number) => void;
}) {
  const { t, tf, lang } = useT();
  const navigate = useNavigate();
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const input = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();

  const hits = React.useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase();
    const match = (...s: string[]) => !needle || s.some((x) => x?.toLowerCase().includes(needle));
    return [
      ...forms.filter((f) => match(f.title_mr, f.title_en, f.slug)).map((form) => ({ kind: "form" as const, form })),
      ...(needle ? campaigns.filter((c) => match(c.title_mr, c.title_en, c.slug)).map((c) => ({ kind: "campaign" as const, c })) : []),
    ].slice(0, 12);
  }, [q, forms, campaigns]);

  React.useEffect(() => setActive(0), [q]);

  // "/" from anywhere on the page jumps to the search
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && !el.isContentEditable) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = (h: Hit) => {
    if (h.kind === "form") onForm(h.form.id);
    else navigate(`/campaigns/${h.c.id}`);
    setQ(""); setOpen(false); input.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && open && hits[active]) { e.preventDefault(); pick(hits[active]); }
    else if (e.key === "Escape") { setOpen(false); input.current?.blur(); }
  };

  return (
    <div className="relative">
      <div className="flex min-h-16 items-center gap-3 rounded-2xl border-[1.5px] border-r-line bg-r-card px-5 focus-within:border-r-ink focus-within:shadow-[0_0_0_3px_var(--r-focus)]">
        <Search className="size-6 shrink-0 text-r-muted" aria-hidden />
        <input ref={input} type="search" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && hits[active] ? `${listId}-${active}` : undefined}
          value={q} placeholder={t("desk_search")} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown}
          className="min-w-0 flex-1 border-0 bg-transparent py-4 text-lg text-r-ink outline-none! placeholder:text-r-faint sm:text-xl [&::-webkit-search-cancel-button]:hidden" />
        {q ? (
          <button type="button" aria-label="Clear" onMouseDown={(e) => e.preventDefault()} onClick={() => setQ("")}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full border-0 bg-r-sunk text-r-muted"><X className="size-4" /></button>
        ) : <kbd className="hidden rounded-md border border-r-line px-2 py-0.5 text-sm text-r-muted sm:block">/</kbd>}
      </div>
      {open && (
        <div id={listId} role="listbox" className="absolute inset-x-0 top-full z-30 mt-2 max-h-[60vh] overflow-y-auto rounded-2xl border border-r-line bg-r-card p-2 shadow-xl">
          {!hits.length ? <p className="m-0 px-3 py-4 text-sm text-r-muted">{tf("desk_no_match", { q: q.trim() })}</p> : hits.map((h, i) => {
            const id = `${listId}-${i}`;
            const isForm = h.kind === "form";
            const title = isForm ? formTitle(h.form, lang) : formTitle(h.c, lang);
            const sub = isForm
              ? `${t(`status_${h.form.status}` as "status_draft")} · ${t(`freq_${h.form.frequency}` as "freq_daily")}`
              : t("campaign");
            return (
              <div key={isForm ? `f${h.form.id}` : `c${h.c.id}`} id={id} role="option" aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(h)}
                className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2", i === active && "bg-r-sunk")}>
                {isForm
                  ? <span className={cn("mx-[3px] size-2.5 shrink-0 rounded-full", h.form.status === "published" ? "bg-r-accepted" : h.form.status === "draft" ? "border-2 border-dashed border-r-muted" : "bg-r-faint")} aria-hidden />
                  : <Megaphone className="size-4 shrink-0 text-r-muted" aria-hidden />}
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <b className="truncate">{title}</b>
                  <span className="text-[13px] text-r-muted">{sub}</span>
                </span>
                {isForm && h.form.id === current && <span className="rounded-full bg-r-sunk px-2 py-0.5 text-xs font-bold text-r-muted">✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- page
export default function DeskPage() {
  const tr = useT();
  const { t, tf, lang } = tr;
  const f = useFormFilters(14);
  const form = f.form;
  const { data: meta } = useMeta();
  const now = Date.now();
  const ps = form ? reportingPeriod(form, f.lastDay, now) : "";
  const win = form ? windowOf(form, ps, form.frequency === "weekly" ? 8 : 14) : { start: "", end: "" };
  const resp = useResponses(f.formId, win.start, win.end, "", f.ready);
  const comp = useCompliance(f.formId, win.start, win.end, "", f.ready);
  const [filter, setFilter] = React.useState<Filter>("all");
  React.useEffect(() => setFilter("all"), [f.formId]);

  const cols = sumColumns(form);
  const rows = resp.data?.rows ?? [];
  const cdata = comp.data;
  const j = cdata ? cdata.periods.indexOf(ps) : -1;
  const dl = form && ps ? deadlineOf(form, ps) : null;

  const today = rows.filter((r) => r.period_start === ps);
  const count = (s: Filter) => s === "all" ? today.length : today.filter((r) => s === "none" ? !isSent(r.status) : r.status === s).length;
  const received = today.filter((r) => isSent(r.status)).length;
  const late = today.filter((r) => isSent(r.status) && r.late).length;
  const divisions = React.useMemo(() => {
    const m = new Map<string, { name: string; rows: ResponseRow[] }>();
    today.forEach((r) => { const d = m.get(r.division) ?? { name: r.division_mr, rows: [] }; d.rows.push(r); m.set(r.division, d); });
    return [...m.entries()];
  }, [today]);
  const older = cdata && form ? cdata.rows.reduce((acc, r) => {
    const days = r.cells.filter((c, k) => k !== j && cellInfo(form, cdata.periods[k], c, now).overdue).length;
    return { days: acc.days + days, offices: acc.offices + (days ? 1 : 0) };
  }, { days: 0, offices: 0 }) : { days: 0, offices: 0 };
  const chase = cdata && form && j >= 0 ? chaseText({ form, data: cdata, j, withOld: true, tr, now }) : "";
  const respTo = (r: ResponseRow) => `/forms/responses${qs({ form: f.formId, day: r.period_start, office: r.office })}`;
  const shown = (r: ResponseRow) => filter === "all" || (filter === "none" ? !isSent(r.status) : r.status === filter);
  const error = resp.error ?? comp.error;

  const chips: { k: Filter; label: string; mark?: React.ReactNode }[] = [
    { k: "all", label: t("all_districts") },
    { k: "none", label: t("not_received"), mark: <StatusMark mark="pend" /> },
    { k: "submitted", label: t("sub_submitted"), mark: <StatusMark mark="sub" /> },
    { k: "returned", label: t("sub_returned"), mark: <StatusMark mark="ret" /> },
  ];

  return (
    <div className="rpt flex flex-col gap-5">
      <DeskSearch forms={f.forms ?? []} campaigns={meta?.campaigns ?? []} current={f.formId}
        onForm={(id) => f.set({ form: id, start: null, end: null, day: null })} />

      {error ? <RError error={error} /> : !form || !resp.data ? (
        <div className="h-96 animate-pulse rounded-2xl bg-r-sunk" />
      ) : (
        <RCard className="gap-5 p-5 sm:p-6">
          {/* header: which form, which period, how far along */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="text-[13px] font-bold tracking-[0.06em] text-r-muted uppercase">
                {periodName(form, ps, lang)}{dl && ` · ${t("due_label")} ${dl.getTime() - now < 864e5 && dl.getTime() > now ? timeOf(dl, lang) : whenText(dl, lang)}`}
              </div>
              <h1 className="disp m-0 text-[28px] leading-[1.08] font-bold sm:text-[36px]">{formTitle(form, lang)}</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              {count("none") > 0 && chase && <CopyButton text={chase} label={t("copy_whatsapp")} done={t("copied_whatsapp")} />}
              <RButton asChild size="sm" variant="ghost">
                <a href={backendUrl(`/api/forms/${f.formId}/export${qs({ start: form.start_date, end: f.lastDay })}`)} download><FileSpreadsheet aria-hidden /> {t("export_workbook")}</a>
              </RButton>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="num text-xl font-bold">{tf("n_received", { a: received, b: today.length })}</span>
              {late > 0 && <span className="text-sm font-bold text-r-late">{late} {t("late")}</span>}
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-r-sunk" aria-hidden>
              <div className="bg-r-action" style={{ width: `${(100 * count("submitted")) / Math.max(1, today.length)}%` }} />
              <div className="bg-r-overdue" style={{ width: `${(100 * count("returned")) / Math.max(1, today.length)}%` }} />
            </div>
          </div>

          {/* filter chips double as the at-a-glance counts */}
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("show")}>
            {chips.map((c) => (
              <button key={c.k} type="button" aria-pressed={filter === c.k} onClick={() => setFilter(c.k)}
                className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-3.5 text-sm font-bold",
                  filter === c.k ? "border-r-ink bg-r-ink text-r-card" : "border-r-line bg-r-card text-r-ink hover:bg-r-sunk")}>
                {c.mark}{c.label} <span className="num opacity-70">{count(c.k)}</span>
              </button>
            ))}
          </div>

          {older.days > 0 && (
            <div className="flex items-center gap-2.5 rounded-[10px] bg-r-overdue-soft px-3 py-2.5 text-sm text-r-overdue-ink">
              <StatusMark mark="over" />
              <span className="flex-1">{tf("older_overdue", { d: older.days, o: older.offices })}</span>
            </div>
          )}

          {/* every district, under its division */}
          {!today.some(shown) ? <p className="m-0 text-sm text-r-muted">{filter === "none" ? t("everyone_sent") : t("nothing_in_filter")}</p> : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-4">
              {divisions.filter(([, d]) => d.rows.some(shown)).map(([code, d]) => {
                const sent = d.rows.filter((r) => isSent(r.status)).length;
                return (
                  <section key={code} className="flex flex-col rounded-xl border border-r-line-soft">
                    <header className="flex items-center justify-between gap-2 rounded-t-xl bg-r-sunk px-4 py-2.5">
                      <h2 className="m-0 truncate text-base font-bold">{d.name}</h2>
                      <span className={cn("num text-sm font-bold", sent === d.rows.length ? "text-r-accepted" : "text-r-muted")}>{sent} / {d.rows.length}</span>
                    </header>
                    <div className="flex flex-col px-2">
                      {d.rows.filter(shown).map((r) => (
                        <DistrictRow key={r.office} r={r} form={form} history={rows} cols={cols} to={respTo(r)} overdue={isOverdue(r.status, dl, now)} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </RCard>
      )}
    </div>
  );
}

function DistrictRow({ r, form, history, cols, to, overdue }: {
  r: ResponseRow; form: FormDef; history: ResponseRow[]; cols: FormField[]; to: string; overdue: boolean;
}) {
  const { t, tf, lang } = useT();
  const sent = isSent(r.status);
  const name = lang === "en" && r.office_name_en ? r.office_name_en : r.office_name_mr;
  const a = r.status === "submitted" ? anomalyOf(r, history, cols) : null;
  const z = r.status === "submitted" ? zerosOf(r, cols) : 0;
  const flag = a ? tf("x_usual", { f: fieldLabel(a.field, lang), x: Number.isFinite(a.ratio) ? Math.round(a.ratio) : "∞" }) : z ? tf("n_zeros_short", { n: z }) : "";
  const when = r.submitted_at ? (r.submitted_at.slice(0, 10) === r.period_end ? timeOf(r.submitted_at, lang) : whenText(r.submitted_at, lang)) : "";
  const sub = !sent
    ? (overdue ? t("overdue") : r.status === "draft" ? t("sub_draft") : "")
    : [t(`sub_${r.status}` as "sub_submitted"), when, r.late ? t("late") : "", r.status === "returned" ? r.review_note : ""].filter(Boolean).join(" · ");

  return (
    <div className="flex min-h-[52px] items-center gap-3 border-t border-r-sunk px-2 py-1.5 first:border-t-0">
      <StatusMark mark={markOf(r.status, overdue)} late={sent && r.late} />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <b className="truncate">{name}</b>
        {(sub || flag) && (
          <span className={cn("truncate text-[13px]", overdue ? "font-bold text-r-overdue-ink" : "text-r-muted")}>
            {sub}{flag && <span className="ml-1.5 rounded-full bg-r-sunk px-1.5 py-px text-xs font-bold text-r-ink">{flag}</span>}
          </span>
        )}
      </span>
      {!sent ? (
        <span className="inline-flex min-h-9 shrink-0 items-center rounded-lg border-[1.5px] border-dashed border-r-line px-3 text-sm font-bold text-r-muted">{t("not_received")}</span>
      ) : (
        <RButton asChild size="sm" variant={r.status === "submitted" ? "pri" : "default"} className="shrink-0">
          <Link to={to} title={periodName(form, r.period_start, lang)}>{r.status === "submitted" ? t("review") : t("view")}</Link>
        </RButton>
      )}
    </div>
  );
}
