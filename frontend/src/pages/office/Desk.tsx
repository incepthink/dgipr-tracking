import * as React from "react";
import { Link } from "react-router-dom";
import { ChevronDown, FileSpreadsheet, Search, X } from "lucide-react";
import { backendUrl, type CampaignBrief, type FormDef, type FormField, type ResponseRow } from "@/lib/api";
import { useMeta } from "@/lib/hooks";
import { useT, type TKey } from "@/lib/i18n";
import { cn, qs } from "@/lib/utils";
import { RButton, RCard, RChip, RError, StatusMark, markOf } from "@/components/reports/kit";
import { deadlineOf, isOverdue, timeOf, whenText } from "@/components/reports/period";
import { fieldLabel, formTitle, sumColumns, useFormDef, useForms, useToday } from "../forms/common";
import { officeName, shortOffice } from "../forms/Responses";
import { cellInfo, chaseText, CopyButton, formRange, periodName, reportingPeriod, useCompliance, useResponses, windowOf } from "./shared";

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
const norm = (s: string) => s.normalize("NFC").toLowerCase();

/** Search by form title, slug or campaign, as in the campaign picker elsewhere. */
function matchesForm(x: FormDef, campaign: CampaignBrief | undefined, needle: string) {
  return !needle || [x.title_mr, x.title_en, x.slug, campaign?.title_mr, campaign?.title_en].some((s) => s && norm(s).includes(needle));
}

/** The search box's state for a list of form cards: typing narrows `shown`, picking one shows only that card until the text
 * changes. Used by the Desk and the Report forms list. */
export function useFormSearch<F extends FormDef>(forms: F[]) {
  const { lang } = useT();
  const { data: meta } = useMeta();
  const [q, setQ] = React.useState("");
  const [picked, setPicked] = React.useState<{ id: number; q: string } | null>(null);
  const campaignOf = React.useCallback((x: FormDef) => meta?.campaigns.find((c) => c.id === x.campaign_id), [meta]);
  const needle = norm(q.trim());
  const shown = picked && picked.q === q ? forms.filter((x) => x.id === picked.id) : forms.filter((x) => matchesForm(x, campaignOf(x), needle));
  const onPick = (x: FormDef) => { const title = formTitle(x, lang); setQ(title); setPicked({ id: x.id, q: title }); };
  return { q, setQ, needle, shown, campaignOf, onPick };
}

/** A dropdown of the page's forms: focus lists them all, typing narrows the list and the cards below, picking one shows only
 * that card. It never navigates. */
export function DeskSearch({ q, setQ, forms, campaignOf, onPick }: {
  q: string; setQ: (q: string) => void; forms: FormDef[];
  campaignOf: (x: FormDef) => CampaignBrief | undefined; onPick: (x: FormDef) => void;
}) {
  const { t, tf, lang } = useT();
  const input = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const needle = norm(q.trim());
  const hits = forms.filter((x) => matchesForm(x, campaignOf(x), needle));
  const cur = Math.min(active, Math.max(0, hits.length - 1));
  const optId = (i: number) => `desk-opt-${i}`;
  const pick = (x: FormDef) => { onPick(x); setOpen(false); input.current?.blur(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setQ(""); setOpen(false); input.current?.blur(); return; }
    if (!hits.length) return;
    const move = (i: number) => { e.preventDefault(); setOpen(true); setActive(i); document.getElementById(optId(i))?.scrollIntoView({ block: "nearest" }); };
    if (e.key === "ArrowDown") move(open ? (cur + 1) % hits.length : cur);
    else if (e.key === "ArrowUp") move((cur - 1 + hits.length) % hits.length);
    else if (e.key === "Enter" && open) { e.preventDefault(); pick(hits[cur]); }
  };

  // "/" from anywhere on the page jumps to the search
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && !el.isContentEditable) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative z-20">
      <div className="flex min-h-16 items-center gap-3 rounded-2xl border-[1.5px] border-r-line bg-r-card px-5 focus-within:border-r-ink focus-within:shadow-[0_0_0_3px_var(--r-focus)]">
        <Search className="size-6 shrink-0 text-r-muted" aria-hidden />
        <input ref={input} type="search" value={q} placeholder={t("desk_search")} aria-label={t("desk_search")}
          role="combobox" aria-expanded={open} aria-controls="desk-list" aria-autocomplete="list"
          aria-activedescendant={open && hits.length ? optId(cur) : undefined}
          onFocus={() => { setOpen(true); setActive(0); }} onBlur={() => setOpen(false)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }} onKeyDown={onKey}
          className="min-w-0 flex-1 border-0 bg-transparent py-4 text-lg text-r-ink outline-none! placeholder:text-r-faint sm:text-xl [&::-webkit-search-cancel-button]:hidden" />
        {q ? (
          <button type="button" aria-label="Clear" onMouseDown={(e) => e.preventDefault()} onClick={() => { setQ(""); input.current?.focus(); }}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full border-0 bg-r-sunk text-r-muted"><X className="size-4" /></button>
        ) : <kbd className="hidden rounded-md border border-r-line px-2 py-0.5 text-sm text-r-muted sm:block">/</kbd>}
      </div>
      {/* floats over the cards; the outer box positions it because .rpt makes every .overflow-auto position: relative */}
      {open && <div className="absolute inset-x-0 top-full mt-2">
        <div id="desk-list" role="listbox" aria-label={t("desk_search")}
          className="flex max-h-[60vh] flex-col gap-1 overflow-auto rounded-2xl border-[1.5px] border-r-line bg-r-card p-2 shadow-lg">
          {!hits.length ? <p className="m-0 px-3 py-2.5 text-r-muted">{tf("desk_no_match", { q: q.trim() })}</p> : hits.map((x, i) => {
            const c = campaignOf(x);
            return (
              <div key={x.id} id={optId(i)} role="option" aria-selected={i === cur}
                onMouseDown={(e) => e.preventDefault()} onMouseMove={() => i !== cur && setActive(i)} onClick={() => pick(x)}
                className={cn("flex cursor-pointer items-start gap-3 rounded-xl border-[1.5px] px-3 py-2.5",
                  i === cur ? "border-r-action bg-r-action-soft" : "border-transparent hover:bg-r-sunk")}>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-bold wrap-break-word">{formTitle(x, lang)}</span>
                  {c && <span className="text-sm text-r-muted">{formTitle(c, lang)}</span>}
                  <span className="num text-[13px] text-r-muted">{formRange(x, lang)}</span>
                </div>
                <RChip className="shrink-0">{t(`freq_${x.frequency}` as TKey)}</RChip>
              </div>
            );
          })}
        </div>
      </div>}
    </div>
  );
}

// --------------------------------------------------------------------------- minimized cards
/** Which form cards are minimized, kept per browser so the Desk opens the way it was left. A card nobody has toggled starts
 * minimized on a phone (below Tailwind's sm, 640px) and open on anything wider. */
const MIN_KEY = "desk-minimized";

function useMinimized() {
  const [phone] = React.useState(() => window.matchMedia("(max-width: 639px)").matches);
  const [set, setSet] = React.useState<Record<string, boolean>>(() => {
    try { const v = JSON.parse(localStorage.getItem(MIN_KEY) || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
    catch { return {}; }
  });
  const isMin = (id: number) => set[id] ?? phone;
  return {
    isMin,
    toggle: (id: number) => {
      const next = { ...set, [id]: !isMin(id) };
      setSet(next);
      try { localStorage.setItem(MIN_KEY, JSON.stringify(next)); } catch { /* storage off */ }
    },
  };
}

// --------------------------------------------------------------------------- page
/** Every form running today, newest first, one card under another; the search hides the ones that don't match.
 * A form that has ended or not yet started is left out: the Desk is today's work only. */
export default function DeskPage() {
  const { t, tf } = useT();
  const { data: forms } = useForms();
  const today = useToday();

  const live = React.useMemo(() => (forms ?? [])
    .filter((x) => (x.status === "published" || x.status === "paused") && x.start_date <= today
      && (x.frequency === "once" ? x.start_date === today : !x.end_date || x.end_date >= today))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id), [forms, today]);
  const { q, setQ, needle, shown, campaignOf, onPick } = useFormSearch(live);
  const min = useMinimized();

  return (
    <div className="rpt flex flex-col gap-6 sm:gap-8">
      <DeskSearch q={q} setQ={setQ} forms={live} campaignOf={campaignOf} onPick={onPick} />
      <h1 className="disp m-0 px-1 text-2xl font-bold sm:text-[28px]">{t("desk_heading")}</h1>
      {!forms || !today ? <div className="h-96 animate-pulse rounded-2xl bg-r-sunk" />
        : !live.length ? <p className="m-0 px-1 text-sm text-r-muted">{t("desk_nothing_today")}</p>
        : needle && !shown.length ? <p className="m-0 px-1 text-sm text-r-muted">{tf("desk_no_match", { q: q.trim() })}</p>
        : shown.map((x) => <DeskCard key={x.id} formId={x.id} minimized={min.isMin(x.id)} onToggle={() => min.toggle(x.id)} />)}
    </div>
  );
}

function DeskCard({ formId, minimized, onToggle }: { formId: number; minimized: boolean; onToggle: () => void }) {
  const tr = useT();
  const { t, tf, lang } = tr;
  const { data: form, error: formError } = useFormDef(formId);
  const todayDay = useToday();
  const lastDay = form?.end_date && form.end_date < todayDay ? form.end_date : todayDay;
  const ready = !!form && !!todayDay;
  const now = Date.now();
  const ps = form ? reportingPeriod(form, lastDay, now) : "";
  const win = form ? windowOf(form, ps, form.frequency === "weekly" ? 8 : 14) : { start: "", end: "" };
  const resp = useResponses(formId, win.start, win.end, "", ready);
  const comp = useCompliance(formId, win.start, win.end, "", ready);
  const [filter, setFilter] = React.useState<Filter>("all");

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
  const respTo = (r: ResponseRow) => `/forms/responses${qs({ form: formId, day: r.period_start, office: r.office })}`;
  const shown = (r: ResponseRow) => filter === "all" || (filter === "none" ? !isSent(r.status) : r.status === filter);
  const error = formError ?? resp.error ?? comp.error;

  const chips: { k: Filter; label: string; mark?: React.ReactNode }[] = [
    { k: "all", label: t("all_districts") },
    { k: "none", label: t("not_received"), mark: <StatusMark mark="pend" /> },
    { k: "submitted", label: t("sub_submitted") },
    { k: "returned", label: t("sub_returned") },
  ];

  if (error) return <RError error={error} />;
  if (!form || !resp.data) return <div className="h-96 animate-pulse rounded-2xl bg-r-sunk" />;
  return (
    <RCard className={cn("p-5 sm:p-8", minimized ? "gap-5" : "gap-7 sm:gap-8")}>
      {/* header: which form, which period, how far along */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="text-[13px] font-bold tracking-[0.06em] text-r-muted uppercase">
            {periodName(form, ps, lang)}{dl && ` · ${t("due_label")} ${dl.getTime() - now < 864e5 && dl.getTime() > now ? timeOf(dl, lang) : whenText(dl, lang)}`}
          </div>
          <h2 className="disp m-0 text-[28px] leading-[1.08] font-bold sm:text-[36px]">{formTitle(form, lang)}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {count("none") > 0 && chase && <CopyButton text={chase} label={t("copy_whatsapp")} done={t("copied_whatsapp")} />}
          <RButton asChild size="sm" variant="ghost">
            <a href={backendUrl(`/api/forms/${formId}/export${qs({ start: form.start_date, end: lastDay })}`)} download><FileSpreadsheet aria-hidden /> {t("export_workbook")}</a>
          </RButton>
          <RButton size="sm" variant="ghost" aria-expanded={!minimized} onClick={onToggle}>
            <ChevronDown className={cn("transition-transform", minimized ? "-rotate-90" : "rotate-180")} aria-hidden />
            {t(minimized ? "desk_expand" : "desk_minimize")}
          </RButton>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="num text-xl font-bold">{tf("n_received", { a: received, b: today.length })}</span>
          {late > 0 && <span className="text-sm font-bold text-r-late">{late} {t("late")}</span>}
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-r-sunk" aria-hidden>
          <div className="bg-r-action" style={{ width: `${(100 * count("submitted")) / Math.max(1, today.length)}%` }} />
          <div className="bg-r-overdue" style={{ width: `${(100 * count("returned")) / Math.max(1, today.length)}%` }} />
        </div>
      </div>

      {!minimized && <>
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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-5">
          {divisions.filter(([, d]) => d.rows.some(shown)).map(([code, d]) => {
            const sent = d.rows.filter((r) => isSent(r.status)).length;
            return (
              <section key={code} className="flex flex-col rounded-xl border border-r-line-soft">
                <header className="flex items-center justify-between gap-2 rounded-t-xl bg-r-sunk px-4 py-3">
                  <h3 className="m-0 min-w-0 wrap-break-word text-base font-bold">{d.name}</h3>
                  <span className={cn("num text-sm font-bold", sent === d.rows.length ? "text-r-accepted" : "text-r-muted")}>{sent} / {d.rows.length}</span>
                </header>
                <div className="flex flex-col px-2 py-1">
                  {d.rows.filter(shown).map((r) => (
                    <DistrictRow key={r.office} r={r} form={form} history={rows} cols={cols} to={respTo(r)} overdue={isOverdue(r.status, dl, now)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      </>}
    </RCard>
  );
}

function DistrictRow({ r, form, history, cols, to, overdue }: {
  r: ResponseRow; form: FormDef; history: ResponseRow[]; cols: FormField[]; to: string; overdue: boolean;
}) {
  const { t, tf, lang } = useT();
  const sent = isSent(r.status);
  const a =r.status === "submitted" ? anomalyOf(r, history, cols) : null;
  const z = r.status === "submitted" ? zerosOf(r, cols) : 0;
  const flag = a ? tf("x_usual", { f: fieldLabel(a.field, lang), x: Number.isFinite(a.ratio) ? Math.round(a.ratio) : "∞" }) : z ? tf("n_zeros_short", { n: z }) : "";
  const when = r.submitted_at ? (r.submitted_at.slice(0, 10) === r.period_end ? timeOf(r.submitted_at, lang) : whenText(r.submitted_at, lang)) : "";
  const sub = !sent
    ? (overdue ? t("overdue") : r.status === "draft" ? t("sub_draft") : "")
    : [t(`sub_${r.status}` as "sub_submitted"), when, r.late ? t("late") : "", r.status === "returned" ? r.review_note : ""].filter(Boolean).join(" · ");

  return (
    <div className="flex min-h-14 items-center gap-3 border-t border-r-sunk px-2 py-2.5 first:border-t-0">
      <StatusMark mark={markOf(r.status, overdue)} late={sent && r.late} />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        {/* short form drops the shared "District Information Office," prefix so the district itself shows; wraps, never clips */}
        <b title={officeName(r, lang)} className="wrap-break-word">{shortOffice(r, lang)}</b>
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
