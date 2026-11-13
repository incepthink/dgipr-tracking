import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, CalendarDays, Check, ChevronDown, Clock, FileSpreadsheet, Loader2, Maximize2, Minimize2, Undo2, Upload, X } from "lucide-react";
import { api, ApiError, backendUrl, type AnswerValue, type FormDef, type FormField, type Proof, type ResponseRow, type Submission, type ValueEdit } from "@/lib/api";
import { useT, type TKey } from "@/lib/i18n";
import { addDays, byMenuOrder, cn, dmy } from "@/lib/utils";
import { RButton, RError, RPage, RSearch, RSheet, RTitle } from "@/components/reports/kit";
import { fig, periodOf, rangeText, shortDay, stepOf, timeOf, whenText } from "@/components/reports/period";
import { MonthCalendar } from "@/components/reports/DateInput";
import { useMeta } from "@/lib/hooks";
import { useUser } from "@/lib/auth";
import { FormNumber, fieldLabel, formTitle, useFormFilters, useFormNumbers } from "./common";
import { periodName, useResponses } from "../office/shared";
import { FILE_TYPES, ProofList, fieldTakesFiles, proofDraftOf, proofPayload, uploadPicked, type FileItem } from "./ProofBox";
import { problemOf } from "./FillForm";

const SENT = ["submitted", "returned"];
/** A sent row with a figure that needs proof and has none. */
const lacksProof = (r: ResponseRow) => SENT.includes(r.status) && (r.proof_missing?.length ?? 0) > 0;
/** Every live link and file of a row, over all its fields. */
const proofCount = (r: ResponseRow) => Object.values(r.proofs ?? {}).reduce((n, l) => n + l.length, 0);

export function showValue(f: FormField, v: AnswerValue, t: (k: TKey) => string) {
  if (v === null || v === undefined || v === "") return "—";
  if (f.type === "yesno") return v === "yes" ? t("yes") : t("no");
  return typeof v === "number" ? fig(v) : String(v);
}

export const officeName = (r: ResponseRow, lang: string) => (lang === "en" && r.office_name_en ? r.office_name_en : r.office_name_mr);

/** Table spelling: "Divisional Information Office, Pune" → "Div. Pune", "District Information Office, Pune" →
 * "Dist. Pune", "Chhatrapati" → "Chh." (as the Marathi "विमाका, छ."). */
export const shortOffice = (r: ResponseRow, lang: string) => officeName(r, lang)
  .replace(/^Divisional Information Office,?\s*/i, "Div. ")
  .replace(/^District Information Office,?\s*/i, "Dist. ")
  .replace(/^Headquarters,?\s*/i, "HQ ")
  .replace(/\bChhatrapati\s+/g, "Chh. ")
  .replace(/^(विमाका|जिमाका|संचालक|मुख्यालय),?\s*/, "$1 ");
/** Lower case, punctuation as spaces, one space between words: "District Information Office, Pune" → "district information office pune". */
const norm = (s: string) => s.normalize("NFC").toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
/** The words of a search; a row matches when every word is found somewhere in what it is searched against. */
const words = (q: string) => norm(q).split(" ").filter(Boolean);
const matches = (hay: string, ws: string[]) => ws.every((w) => hay.includes(w));

/** A column sort, as in a spreadsheet: "office", "sent" or a field key. */
type Sort = { key: string; dir: "asc" | "desc" };
const OFFICE = "office";
const SENT_COL = "sent";

/** The value a row sorts by in a column; null (blank, or not sent) always sinks to the bottom. */
function sortValue(r: ResponseRow, key: string, fields: FormField[], lang: string): number | string | null {
  if (key === OFFICE) return shortOffice(r, lang);
  if (key === SENT_COL) return SENT.includes(r.status) && r.submitted_at ? r.submitted_at : null;
  if (!SENT.includes(r.status) && r.status !== "draft") return null;
  const v = r.values[key];
  if (v === null || v === undefined || v === "") return null;
  if (fields.find((x) => x.key === key)?.type === "yesno") return v === "yes" ? 1 : 0;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : String(v);
}

function sortRows(rows: ResponseRow[], sort: Sort | null, fields: FormField[], lang: string) {
  if (!sort) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort.key, fields, lang);
    const y = sortValue(b, sort.key, fields, lang);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    if (typeof x === "number" && typeof y === "number") return sign * (x - y);
    return sign * String(x).localeCompare(String(y), lang === "mr" ? "mr" : "en", { numeric: true });
  });
}

/** Every period of a form so far, capped at the latest 62 (the most the API serves at once). */
export function allRange(form: FormDef, today: string) {
  const last = form.end_date && form.end_date < today ? form.end_date : today;
  const end = periodOf(form, last);
  return { start: [form.start_date, addDays(end, -61 * stepOf(form))].sort().at(-1)!, end };
}

/** Forms that have started, newest first (live and paused; archived too when asked). */
export function startedForms(forms: FormDef[], today: string, archived = false) {
  return forms.filter((x) => (x.status === "published" || x.status === "paused" || (archived && x.status === "archived")) && x.start_date <= today)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
}

const GROUPS = ["published", "paused", "archived"] as const;
const GROUP_DOT: Record<(typeof GROUPS)[number], string> = { published: "bg-r-accepted", paused: "bg-r-returned", archived: "border-2 border-r-faint" };

export default function ResponsesPage() {
  const { t, tf } = useT();
  const f = useFormFilters();
  const today = f.today;
  const q = f.params.get("q") || "";
  // the shared form list leaves out archived forms; this one includes them
  const { data: withArchived } = useQuery({ queryKey: ["forms", { archived: true }], queryFn: () => api.get<FormDef[]>("/api/forms?archived=true") });
  const all = withArchived ?? f.forms;
  const forms = React.useMemo(() => (all && today ? startedForms(all, today, true) : []), [all, today]);

  // sections opened by hand; while searching, matching sections open unless closed by hand.
  // A link that names a form (?form=, e.g. Review on the desk) opens that section, at ?day= if given.
  const target = Number(f.params.get("form")) || 0;
  const targetDay = f.params.get("day");
  const targetOffice = f.params.get("office") || "";
  const [opened, setOpened] = React.useState<Set<number>>(() => new Set(target ? [target] : []));
  const [closed, setClosed] = React.useState<Set<number>>(new Set());
  React.useEffect(() => setClosed(new Set()), [q]);
  // a link that names a form and an office (an office on the Desk) opens just that form, not every form the office matches
  const isOpen = (id: number) => !closed.has(id) && (opened.has(id) || (!!q.trim() && (!target || id === target)));
  const toggle = (id: number) => {
    const add = (s: Set<number>) => new Set(s).add(id);
    const del = (s: Set<number>) => { const n = new Set(s); n.delete(id); return n; };
    if (isOpen(id)) { setOpened(del); setClosed(add); } else { setOpened(add); setClosed(del); }
  };

  // each section reports how many rows match the search, so we can say when nothing does
  const [hits, setHits] = React.useState<Record<number, number>>({});
  const onHits = React.useCallback((id: number, n: number) => setHits((h) => (h[id] === n ? h : { ...h, [id]: n })), []);
  const noMatch = !!q.trim() && forms.length > 0 && forms.every((x) => hits[x.id] === 0);

  return (
    <RPage>
      <RTitle title={t("nav_responses")} />

      <RSearch value={q} placeholder={t("resp_search")} onChange={(v) => f.set({ q: v || null, form: null })} />

      <div className="mt-5 flex flex-col gap-6">
        {!all ? <div className="h-40 animate-pulse rounded-2xl bg-r-sunk" />
          : !forms.length ? <p className="m-0 rounded-2xl bg-r-card p-5 text-r-muted">{t("no_forms")}</p>
          : GROUPS.map((g) => {
            const list = forms.filter((x) => x.status === g);
            // while searching, a group hides once none of its forms match
            if (!list.length || (q.trim() && list.every((x) => hits[x.id] === 0))) return null;
            return (
              <section key={g} aria-labelledby={`resp-${g}`} className="flex flex-col gap-3">
                <h2 id={`resp-${g}`} className="m-0 flex items-center gap-2 text-[15px] font-bold text-r-muted">
                  <span className={cn("size-2 rounded-full", GROUP_DOT[g])} aria-hidden />
                  {t(`resp_group_${g}`)} <span className="num font-normal">· {list.length}</span>
                </h2>
                {list.map((x) => (
                  <FormSection key={x.id} form={x} today={today} day={x.id === target ? targetDay : null} office={x.id === target ? targetOffice : ""} q={q}
                    open={isOpen(x.id)} focus={x.id === target} onToggle={() => toggle(x.id)} onHits={onHits} />
                ))}
              </section>
            );
          })}
        {noMatch && <p className="m-0 rounded-2xl bg-r-card p-5 text-r-muted">{tf("resp_no_match", { q: q.trim() })}</p>}
      </div>
    </RPage>
  );
}

// --------------------------------------------------------------------------- zone / district filters
/** Zone (state users only; a zone officer already sees just their own) and district, which lists the chosen zone's offices.
 * Drawn like the "All dates" button and the date picker beside them: dark outline once something is picked. */
function PlaceFilters({ division, office, onChange }: {
  division: string; office: string; onChange: (p: { division?: string; office?: string }) => void;
}) {
  const me = useUser();
  const { data: meta } = useMeta();
  const { t, name } = useT();
  const all = byMenuOrder(meta?.divisions ?? [], (d) => d.code);
  const divs = all.filter((d) => !division || d.code === division);
  const zones = me.role === "state" && all.length > 1;
  const districts = divs.flatMap((d) => d.offices).length > 1;
  if (!zones && !districts) return null;
  return (
    <>
      {zones && (
        <PlaceSelect label={t("role_zone")} value={division} onChange={(v) => onChange({ division: v, office: "" })}>
          <option value="">{t("resp_all_zones")}</option>
          {all.map((d) => <option key={d.code} value={d.code}>{d.label_mr}</option>)}
        </PlaceSelect>
      )}
      {districts && (
        <PlaceSelect label={t("zb_district")} value={office} onChange={(v) => onChange({ office: v })}>
          <option value="">{t("resp_all_districts")}</option>
          {divs.map((d) => (
            <optgroup key={d.code} label={d.label_mr}>
              {d.offices.map((o) => <option key={o.code} value={o.code}>{name(o)}</option>)}
            </optgroup>
          ))}
        </PlaceSelect>
      )}
    </>
  );
}

/** On a phone the selects take a row of their own under the date controls, half the width each (the whole row when alone). */
function PlaceSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <span className={cn("relative order-last min-w-0 grow basis-[calc(50%-0.25rem)] rounded-xl border-[1.5px] sm:order-none sm:max-w-56 sm:flex-none",
      value ? "border-r-ink" : "border-r-line")}>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
        className={cn("h-11 w-full min-w-0 cursor-pointer appearance-none truncate rounded-xl border-0 bg-r-card py-0 pr-9 pl-3 text-[15px] font-semibold outline-none hover:bg-r-sunk focus-visible:ring-2 focus-visible:ring-r-action",
          value ? "text-r-ink" : "text-r-muted")}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-r-muted" aria-hidden />
    </span>
  );
}

// --------------------------------------------------------------------------- one form, as a dropdown
/** All dates by default; the calendar inside narrows the dropdown to one date. */
function FormSection({ form, today, day, office: startOffice, q, open, focus, onToggle, onHits }: {
  form: FormDef; today: string; day: string | null; office: string; q: string; open: boolean; focus: boolean;
  onToggle: () => void; onHits: (id: number, n: number) => void;
}) {
  // a link from the Desk can pick one office in the district filter (?office=)
  const [place, setPlace] = React.useState({ division: "", office: startOffice });
  const numbers = useFormNumbers();
  const { division, office } = place;
  const { t, tf, lang } = useT();
  const box = React.useRef<HTMLElement>(null);
  React.useEffect(() => { if (focus) box.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [focus]);
  const qc = useQueryClient();
  const [sel, setSel] = React.useState<string | null>(day);
  const range = allRange(form, today);
  const once = form.frequency === "once";
  const byDate = !sel && !once;
  const ps = periodOf(form, sel ?? range.end);
  const { start, end } = byDate ? range : { start: ps, end: ps };
  const { data, error, isLoading, isPlaceholderData } = useResponses(form.id, start, end, division);
  const fields = (data?.form.fields ?? []).filter((x) => !x.archived);
  const canEdit = data?.can_review ?? false;
  // each division's senior office (मुख्यालय, संचालक, विमाका) stands out from its districts
  const { data: meta } = useMeta();
  const senior = React.useMemo(() => new Set((meta?.divisions ?? []).flatMap((d) => d.offices)
    .filter((o) => o.kind && o.kind !== "district").map((o) => o.code)), [meta]);
  // the zone is filtered by the server; one district is picked out here
  const all = React.useMemo(() => (data?.rows ?? []).filter((r) => r.period_start >= start && r.period_start <= end && (!office || r.office === office)),
    [data, start, end, office]);

  // each search word must match the form's title or the office (any spelling of its name, its code or its zone),
  // so "pune", "dist pune", "जिमाका पुणे" and "<form title> pune" all work
  const ws = React.useMemo(() => words(q), [q]);
  const rows = React.useMemo(() => {
    if (!ws.length) return all;
    const title = norm(`${form.title_mr} ${form.title_en ?? ""}`);
    return all.filter((r) => matches(`${title} ${norm([r.office_name_mr, r.office_name_en, shortOffice(r, "en"), shortOffice(r, "mr"),
      r.office, r.division_mr].join(" "))}`, ws));
  }, [all, ws, form]);
  // a section that could not load counts as no match, so it does not hold up "nothing matches"
  React.useEffect(() => { if (data) onHits(form.id, rows.length); else if (error) onHits(form.id, 0); }, [data, error, rows.length, form.id, onHits]);

  // as in a spreadsheet: a header click sorts high → low (offices A → Z), each further click reverses it
  const [sort, setSort] = React.useState<Sort | null>(null);
  // the column shows while a field asks for proof, or proof is still attached from before it stopped asking
  const asksProof = fields.some((x) => x.proof !== "none") || all.some((r) => proofCount(r) > 0);
  const sortBy = (key: string) => setSort((s) => (s?.key === key
    ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
    : { key, dir: key === OFFICE ? "asc" : "desc" }));

  // newest date first, each date under its own band; the sort applies within each band
  const groups = React.useMemo(() => {
    const shown = rows;
    if (!byDate) return [{ ps: "", rows: sortRows(shown, sort, fields, lang) }];
    const m = new Map<string, ResponseRow[]>();
    shown.forEach((r) => m.set(r.period_start, [...(m.get(r.period_start) ?? []), r]));
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([p, rs]) => ({ ps: p, rows: sortRows(rs, sort, fields, lang) }));
  }, [rows, byDate, sort, fields, lang]);

  // the date band sticks just under the column headings, whose height depends on how their labels wrap
  const head = React.useRef<HTMLTableSectionElement>(null);
  const [headH, setHeadH] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = head.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeadH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data, rows.length]);

  const [busy, setBusy] = React.useState<string | null>(null);
  const [showLog, setShowLog] = React.useState(false);
  // what the Undo button takes back, latest last: each figure typed and each batch of files added in this table
  const [undos, setUndos] = React.useState<{ what: string; run: () => Promise<unknown> }[]>([]);
  const [undoing, setUndoing] = React.useState(false);
  // files still uploading, per row
  const [uploading, setUploading] = React.useState<Record<string, number>>({});

  // full screen: the same body, laid over the page; Escape leaves it unless the history or proof is open on top,
  // or the Escape was for a box in the table
  const [full, setFull] = React.useState(false);
  const overlaid = showLog;
  React.useEffect(() => {
    if (!full) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !overlaid && !(e.target as HTMLElement)?.closest?.("input, select, textarea")) setFull(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", esc);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", esc); };
  }, [full, overlaid]);
  React.useEffect(() => { if (!open) setFull(false); }, [open]);

  const rowId = (r: ResponseRow) => `${r.office}:${r.period_start}`;
  const base = (r: ResponseRow) => `/api/forms/${form.id}/submissions/${r.office}/${r.period_start}`;
  /** Refetches the table (and the desk's counts); resolves once the new rows are in. */
  const refreshNow = () => Promise.all([qc.invalidateQueries({ queryKey: ["responses", form.id] }), qc.invalidateQueries({ queryKey: ["compliance"] })]);
  const refresh = () => { void refreshNow(); };
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : String(e));

  const revert = async (r: ResponseRow, edit: number) => {
    setBusy(rowId(r));
    try { await api.post(`${base(r)}/revert`, { edit_id: edit }); toast.success(t("value_restored")); refresh(); }
    catch (e) { fail(e); } finally { setBusy(null); }
  };

  // saves go to the server one at a time: typing fast across a day nobody has sent would otherwise race to create
  // the same submission twice
  const queue = React.useRef<Promise<unknown>>(Promise.resolve());
  const inTurn = <T,>(fn: () => Promise<T>): Promise<T> => {
    const p = queue.current.then(fn, fn);
    queue.current = p.catch(() => undefined);
    return p;
  };

  /** A figure typed into the table (see set_field in app/forms/service.py: an unsent day becomes sent by the state office). */
  const saveCell = async (r: ResponseRow, x: FormField, v: string) => {
    const out = await inTurn(() => api.post<Submission>(`${base(r)}/field`, { key: x.key, value: v || null, note: "" }));
    const last = out.edits.filter((e) => e.key === x.key).at(-1);
    if (last) setUndos((u) => [...u, { what: `${fieldLabel(x, lang)} · ${shortOffice(r, lang)}`, run: () => api.post(`${base(r)}/revert`, { edit_id: last.id }) }]);
    refresh();  // the box already shows what was typed; the row's status and colour follow
  };

  /** PDFs / photos picked in the Evidence column: uploaded, then added to that column's proof in one save. */
  const upload = async (r: ResponseRow, x: FormField, files: File[]) => {
    const id = rowId(r);
    setUploading((u) => ({ ...u, [id]: files.length }));
    try {
      const items = new Map<string, FileItem>();
      await uploadPicked(files, { formId: form.id, office: r.office, ps: r.period_start, field: x.key },
        (it) => items.set(it.uid, it), (uid, p) => items.set(uid, { ...items.get(uid)!, ...p }), t);
      const done = [...items.values()].filter((it) => it.status === "done");
      [...items.values()].filter((it) => it.status === "error").forEach((it) => toast.error(`${it.name}: ${it.error}`));
      if (!done.length) return;
      const before = proofDraftOf(r.proofs?.[x.key]);
      await inTurn(() => api.post(`${base(r)}/field`, { key: x.key, note: "", proofs: proofPayload({ ...before, files: [...before.files, ...done] }) }));
      const what = `PDF · ${shortOffice(r, lang)}`;
      setUndos((u) => [...u, { what, run: () => api.post(`${base(r)}/field`, { key: x.key, note: "", proofs: proofPayload(before) }) }]);
      toast.success(tf("files_added", { n: done.length, f: what }));
      await refreshNow();
    } catch (e) { fail(e); } finally { setUploading((u) => { const n = { ...u }; delete n[id]; return n; }); }
  };

  const undo = async () => {
    const last = undos.at(-1);
    if (!last) return;
    setUndoing(true);
    try {
      await inTurn(last.run);
      setUndos((u) => u.slice(0, -1));
      toast.success(tf("undone_what", { w: last.what }));
      await refreshNow();
    } catch (e) { fail(e); } finally { setUndoing(false); }
  };

  if (ws.length && (data || error) && !rows.length) return null;
  const sent = all.filter((r) => SENT.includes(r.status)).length;
  const edited = all.filter((r) => Object.keys(r.corrections).length > 0).length;
  const noProof = all.filter(lacksProof).length;
  const bodyId = `form-${form.id}`;
  // PDFs uploaded from the table go to the form's files-only column (newspaper clippings), else the first that takes files
  const fileFields = fields.filter((x) => x.type === "number" && fieldTakesFiles(x));
  const pdfField = fileFields.find((x) => x.proof === "files") ?? fileFields[0] ?? null;
  const pdfOn = (r: ResponseRow) => (canEdit && !!form.proof_from && r.period_start >= form.proof_from ? pdfField : null);
  const when = byDate ? `${t("zb_all_dates")} · ${rangeText(start, end, lang)}` : periodName(form, ps, lang);

  return (
    <section ref={box} className="scroll-mt-4 rounded-2xl border border-r-line bg-r-card transition-shadow has-[>button:hover]:shadow-lg">
      <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}
        className={cn("flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-5 py-4 text-left text-r-ink", open ? "rounded-t-2xl" : "rounded-2xl")}>
        <ChevronDown className={cn("size-5 shrink-0 text-r-muted transition-transform", !open && "-rotate-90")} aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2"><FormNumber small n={numbers.get(form.id)} /><b className="truncate text-[17px]">{formTitle(form, lang)}</b></span>
          <span className="text-[13px] text-r-muted">{when}</span>
          {/* on a phone the chips go under the title, which keeps the full width */}
          {data && <CountChips sent={sent} total={all.length} edited={edited} noProof={noProof}small className="mt-1.5 sm:hidden" />}
        </span>
        {data && <CountChips sent={sent} total={all.length} edited={edited} noProof={noProof}className="hidden justify-end sm:flex" />}
      </button>

      {open && full && <div className="fixed inset-0 z-40 bg-[#15202b]/55" aria-hidden onClick={() => setFull(false)} />}
      {open && (
        <div id={bodyId} role={full ? "dialog" : undefined} aria-modal={full || undefined} aria-label={full ? formTitle(form, lang) : undefined}
          className={cn(full ? "fixed inset-2 z-40 flex flex-col overflow-hidden rounded-2xl border border-r-line bg-r-card shadow-2xl sm:inset-4" : "border-t border-r-line")}>
          {full && (
            <div className="flex items-center gap-3 border-b border-r-line py-2.5 pr-2.5 pl-4 sm:py-3 sm:pr-3 sm:pl-5">
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-[15px] sm:text-[17px]">{formTitle(form, lang)}</b>
                <span className="truncate text-[13px] text-r-muted">{when}</span>
                {data && <CountChips sent={sent} total={all.length} edited={edited} noProof={noProof}small className="mt-1.5 sm:hidden" />}
              </span>
              {data && <CountChips sent={sent} total={all.length} edited={edited} noProof={noProof}className="hidden justify-end sm:flex" />}
              <button type="button" onClick={() => setFull(false)} aria-label={t("close")} title={t("close")}
                className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-r-sunk text-r-ink hover:bg-r-line">
                <X className="size-5" aria-hidden />
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-1">
            {!once && (
              <>
                <button type="button" aria-pressed={byDate} onClick={() => setSel(null)}
                  className={cn("inline-flex h-11.75 cursor-pointer items-center rounded-xl border-[1.5px] px-4 text-[15px] font-semibold",
                    byDate ? "border-r-ink bg-r-card text-r-ink" : "border-r-line bg-r-card text-r-muted hover:bg-r-sunk")}>
                  {t("zb_all_dates")}
                </button>
                <span className={cn("rounded-xl border-[1.5px]", !byDate ? "border-r-ink" : "border-r-line")}>
                  <DatePicker align="left" value={sel ?? range.end} max={today} min={form.start_date} last={form.end_date ?? undefined} onChange={setSel}
                    className={byDate ? "text-r-muted" : undefined} />
                </span>
              </>
            )}
            <PlaceFilters division={division} office={office} onChange={(p) => setPlace((s) => ({ ...s, ...p }))} />
            {/* on a phone only the icons show, so the date controls keep their row */}
            <span className="ml-auto flex items-center gap-1">
            {canEdit && (
              <RButton variant="ghost" size="sm" onClick={undo} disabled={!undos.length || undoing} loading={undoing}
                aria-label={t("undo")} title={undos.length ? `${t("undo")}: ${undos.at(-1)!.what}` : t("nothing_to_undo")}>
                <Undo2 aria-hidden /><span className="hidden sm:inline">{t("undo")}</span>
                {undos.length > 0 && <span className="num font-normal">({undos.length})</span>}
              </RButton>
            )}
            <RButton variant="ghost" size="sm" onClick={() => setFull((f) => !f)} aria-pressed={full}
              aria-label={t(full ? "collapse_table" : "expand_table")} title={t(full ? "collapse_table" : "expand_table")}>
              {full ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
              <span className="hidden sm:inline">{t(full ? "collapse_table" : "expand_table")}</span>
            </RButton>
            </span>
          </div>
          {canEdit && data && <p className="m-0 px-4 pt-1 pb-2 text-[13px] text-r-muted">{t("click_to_edit")}</p>}
          {error ? <div className="p-4"><RError error={error} /></div> : isLoading || !data ? <div className="m-4 h-40 animate-pulse rounded-xl bg-r-sunk" /> : !groups.some((g) => g.rows.length) ? (
            <p className="m-0 p-5 text-r-muted">{t("resp_no_rows")}</p>
          ) : (
            <div className={cn("overflow-auto scrollbar-thin transition-opacity", full ? "min-h-0 flex-1" : "max-h-[70vh]", isPlaceholderData && "opacity-60")}>
              {/* every value column is wide enough that its heading wraps only between words; when they don't all fit,
                  the grid scrolls sideways with the office column pinned */}
              <table className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{ minWidth: 148 + 72 + (asksProof ? 120 : 0) + fields.length * 120 }}>
                <colgroup>
                  <col className="w-[112px] md:w-[148px]" />
                  <col className="w-18" />
                  {asksProof && <col className="w-30" />}
                  {fields.map((x) => <col key={x.key} />)}
                </colgroup>
                <thead ref={head} className="sticky top-0 z-20">
                  <tr>
                    <SortHead col={OFFICE} label={t("office")} sort={sort} onSort={sortBy} className="sticky left-0 z-30 pl-1.5 text-xs before:absolute before:inset-y-0 before:-left-2 before:w-2 before:bg-inherit" />
                    <SortHead col={SENT_COL} label={t("sent")} sort={sort} onSort={sortBy} className="px-0 text-xs" />
                    {asksProof && <th scope="col" className="border-b border-r-line bg-r-card px-1 text-xs font-bold text-r-muted">{t("proof_word")}</th>}
                    {fields.map((x) => <SortHead key={x.key} col={x.key} label={fieldLabel(x, lang)} sort={sort} onSort={sortBy} center
                      className="px-0.5 text-xs leading-snug break-normal" />)}
                  </tr>
                </thead>
                {groups.map((g) => (
                  <tbody key={g.ps || "one"}>
                    {byDate && (
                      <tr>
                        <th scope="colgroup" colSpan={fields.length + (asksProof ? 3 : 2)} style={{ top: headH }}
                          className="sticky z-15 border-b border-r-line bg-r-sunk px-3 py-1.5 text-left text-[13px]">
                          {/* the label also stays at the left edge while the grid scrolls sideways */}
                          <span className="sticky left-3 inline-flex items-center gap-2.5">
                            <span className="font-bold">{periodName(form, g.ps, lang)}</span>
                            <CountChips small onGrey sent={g.rows.filter((r) => SENT.includes(r.status)).length} total={g.rows.length}
                              edited={g.rows.filter((r) => Object.keys(r.corrections).length > 0).length} noProof={g.rows.filter(lacksProof).length} />
                          </span>
                        </th>
                      </tr>
                    )}
                    {g.rows.map((r) => (
                      <Row key={rowId(r)} r={r} senior={senior.has(r.office)} fields={fields} canEdit={canEdit} asksProof={asksProof}
                        pdfField={pdfOn(r)} uploading={uploading[rowId(r)] ?? 0} onSave={(x, v) => saveCell(r, x, v)}
                        onUpload={(x, files) => void upload(r, x, files)} formId={form.id} />
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}

          {data && rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-r-line px-4 py-3">
              <RButton asChild size="sm" variant="ghost">
                <a href={backendUrl(`/api/forms/${form.id}/export?start=${start}&end=${end}${division ? `&division=${division}` : ""}`)} download><FileSpreadsheet aria-hidden /> {t("export_workbook")}</a>
              </RButton>
              <span className="flex items-center gap-3">
                <RButton variant="ghost" size="sm" onClick={() => setShowLog(true)}>
                  <Clock aria-hidden /> {t("history_log")}
                </RButton>
              </span>
            </div>
          )}
        </div>
      )}

      {showLog && data && (
        <HistoryModal form={data.form} when={when} byDate={byDate} rows={all} fields={fields} canEdit={canEdit} busy={busy}
          onRevert={revert} onClose={() => setShowLog(false)}
          onOpen={(r, key) => {
            setShowLog(false);
            // straight to that figure's box in the table
            setTimeout(() => {
              const el = document.querySelector<HTMLElement>(`[data-cell="${CSS.escape(`${rowId(r)}|${key}`)}"]`);
              el?.scrollIntoView({ block: "center", inline: "center" });
              el?.focus();
            }, 80);
          }} />
      )}
    </section>
  );
}

/** "43 of 129 sent" (and "2 edited") as status chips, styled as on My forms: green when every office has sent,
 * soft green part way, grey when none has. */
function CountChips({ sent, total, edited = 0, noProof = 0, small, onGrey, className }: {
  sent: number; total: number; edited?: number; noProof?: number; small?: boolean; onGrey?: boolean; className?: string;
}) {
  const { tf } = useT();
  // one plain colour for every chip: no tints, no borders, just the counts
  const chip = cn("num inline-flex shrink-0 items-center rounded-md font-semibold whitespace-nowrap text-r-ink",
    onGrey ? "bg-r-card" : "bg-r-sunk", small ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-[13px]");
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className={chip}>{tf("resp_counts", { a: sent, b: total })}</span>
      {edited > 0 && <span className={chip}>{tf("resp_edited", { n: edited })}</span>}
      {noProof > 0 && <span className={chip}>{tf("resp_no_proof", { n: noProof })}</span>}
    </span>
  );
}

/** A column heading that sorts the table when clicked, with an arrow showing the current direction. */
function SortHead({ col, label, sort, onSort, center, className }: {
  col: string; label: string; sort: Sort | null; onSort: (key: string) => void; center?: boolean; className?: string;
}) {
  const { tf } = useT();
  const dir = sort?.key === col ? sort.dir : null;
  const Arrow = dir === "asc" ? ArrowUp : ArrowDown;
  // the button fills the whole cell (h-px on the cell lets h-full reach its height), so a click anywhere in a tall heading
  // sorts; the sorted column is tinted, distinct from the hover, so the first click visibly takes
  return (
    <th scope="col" aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
      className={cn("h-px border-b border-r-line bg-r-card p-1 align-middle font-bold", className)}>
      <button type="button" onClick={() => onSort(col)} title={tf("sort_by", { f: label })}
        className={cn("group flex h-full w-full cursor-pointer items-center gap-1 rounded-lg border-0 px-1.5 py-1.5 font-[inherit] leading-[inherit] select-none",
          center ? "justify-center text-center" : "justify-start text-left",
          dir ? "bg-r-action-soft text-r-action" : "bg-transparent text-r-muted hover:bg-r-sunk hover:text-r-ink")}>
        <span className="block min-w-0 text-balance first-letter:uppercase">{label}</span>
        <Arrow className={cn("size-3 shrink-0", dir ? "opacity-100" : "opacity-0 group-hover:opacity-50")} aria-hidden />
      </button>
    </th>
  );
}

function Row({ r, formId, senior, fields, canEdit, asksProof, pdfField, uploading, onSave, onUpload }: {
  r: ResponseRow; formId: number; senior: boolean; fields: FormField[]; canEdit: boolean; asksProof: boolean;
  /** the column PDFs / photos are saved under on this row's day (null: no upload button) */
  pdfField: FormField | null; uploading: number;
  onSave: (x: FormField, v: string) => Promise<void>; onUpload: (x: FormField, files: File[]) => void;
}) {
  const { t, lang } = useT();
  const sent = SENT.includes(r.status);
  // every row plain white: the Sent column already says who has sent
  const bg = "bg-r-card";
  return (
    <tr className={bg}>
      {/* the before: strip paints the row colour a few pixels past the left edge, so no sliver of a cell scrolling
          underneath shows when the pinned column lands on a fractional pixel; a division's senior office gets a bar
          in the action colour and bold type */}
      <th scope="row" className={cn("sticky left-0 z-10 border-b border-r-line-soft px-3 py-1.5 text-left whitespace-nowrap",
        "before:absolute before:inset-y-0 before:-left-2 before:w-2 before:bg-inherit", bg,
        senior ? "font-bold text-r-ink after:absolute after:inset-y-0 after:left-0 after:w-1 after:bg-r-action" : "font-medium")}>
        <span title={officeName(r, lang)} className="block truncate">{shortOffice(r, lang)}</span>
      </th>
      <td className={cn("truncate border-b border-r-line-soft px-1.5 py-1.5 text-xs whitespace-nowrap", sent ? "text-r-muted" : "text-r-overdue-ink")}>
        {sent && r.submitted_at ? (r.submitted_at.slice(0, 10) <= r.period_end ? timeOf(r.submitted_at, lang) : whenText(r.submitted_at, lang)) : r.status === "draft" ? t("sub_draft") : t("sub_none")}
      </td>
      {asksProof && (
        <td className="border-b border-r-line-soft px-1 py-1 text-center">
          {pdfField ? <EvidenceButton formId={formId} office={officeName(r, lang)} uploading={uploading}
              files={Object.values(r.proofs ?? {}).flat().filter((p): p is Proof => p.kind === "file")} onPick={(files) => onUpload(pdfField, files)} />
            : <span className="text-xs text-r-faint">—</span>}
        </td>
      )}
      {fields.map((x) => {
        const v = r.values[x.key];
        const c = r.corrections[x.key];
        const shown = !sent && r.status !== "draft" ? "—" : showValue(x, v, t);
        const noProof = r.proof_missing?.includes(x.key);
        const tip = [c ? `${t("corrected")} · ${t("original")}: ${c.original ?? "—"}${c.note ? ` · ${c.note}` : ""}` : "", noProof ? t("proof_missing_mark") : ""].filter(Boolean).join(" · ") || undefined;
        return (
          <td key={x.key} className={cn("num relative truncate border-b border-r-line-soft text-center", !sent && "text-r-faint", canEdit ? "p-0.5" : "px-1.5 py-1.5")}>
            {canEdit ? <Cell r={r} x={x} cellId={`${r.office}:${r.period_start}|${x.key}`} onSave={(v) => onSave(x, v)} />
              : <span title={tip}>{shown}</span>}
          </td>
        );
      })}
    </tr>
  );
}

// --------------------------------------------------------------------------- typing straight into the table
const same = (a: AnswerValue | undefined, b: AnswerValue | undefined) => (a ?? "") === (b ?? "");
const asText = (v: AnswerValue | undefined) => (v === null || v === undefined ? "" : String(v));
const message = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

/** Moves the focus to the same column `d` rows down (or up) in this table, as Enter / arrows do in a spreadsheet. */
function moveFocus(from: HTMLElement, d: 1 | -1) {
  const col = from.dataset.col;
  const table = from.closest("table");
  if (!col || !table) return;
  const all = [...table.querySelectorAll<HTMLElement>(`[data-col="${CSS.escape(col)}"]`)];
  const next = all[all.indexOf(from) + d];
  if (next) { next.focus(); if (next instanceof HTMLInputElement) next.select(); }
}

/** One figure, editable in place: type it and press Enter (or click away) and it is saved; Escape puts back the saved
 * figure. A field the office never sent shows a dash until something is typed. */
function Cell({ r, x, cellId, onSave }: { r: ResponseRow; x: FormField; cellId: string; onSave: (v: string) => Promise<void> }) {
  const tr = useT();
  const { t, lang } = tr;
  const has = SENT.includes(r.status) || r.status === "draft";
  const savedText = has ? asText(r.values[x.key]) : "";
  const [text, setText] = React.useState(savedText);
  const [state, setState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = React.useState("");
  const focused = React.useRef(false);
  // the server's value replaces the box once it changes, unless someone is typing in it
  React.useEffect(() => { if (!focused.current) { setText(savedText); setErr(""); } }, [savedText]);

  const commit = async (v = text.trim()) => {
    if (v === savedText) { setErr(""); setState("idle"); return; }
    const p = problemOf(x, v, tr);
    if (p) { setErr(p); setState("error"); toast.error(`${fieldLabel(x, lang)}: ${p}`); return; }
    setState("saving");
    try {
      await onSave(v);
      setErr(""); setState("saved");
      setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch (e) {
      setErr(message(e)); setState("error"); toast.error(`${fieldLabel(x, lang)} · ${shortOffice(r, lang)}: ${message(e)}`);
    }
  };

  const c = r.corrections[x.key];
  const noProof = r.proof_missing?.includes(x.key);
  const tip = [err, c ? `${t("corrected")} · ${t("original")}: ${c.original ?? "—"}${c.note ? ` · ${c.note}` : ""}` : "",
    noProof ? t("proof_missing_mark") : ""].filter(Boolean).join(" · ") || t("edit_value");
  const label = `${fieldLabel(x, lang)}, ${officeName(r, lang)}`;
  const box = cn("num block h-8 w-full min-w-0 rounded-md border-0 bg-transparent px-1 text-center text-sm outline-none",
    "hover:bg-r-card hover:ring-1 hover:ring-r-line focus:bg-r-card focus:ring-2 focus:ring-r-action",
    has ? "text-r-ink" : "text-r-faint",
    state === "error" && "bg-r-overdue-soft ring-2 ring-r-overdue", state === "saving" && "opacity-50");

  return (
    <>
      {x.type === "yesno" || x.type === "choice" ? (
        <select data-col={x.key} data-cell={cellId} aria-label={label} title={tip} value={text} disabled={state === "saving"}
          onChange={(e) => { setText(e.target.value); void commit(e.target.value); }} className={cn(box, "cursor-pointer")}>
          <option value="">—</option>
          {(x.type === "yesno" ? ["yes", "no"] : x.options).map((o) => <option key={o} value={o}>{x.type === "yesno" ? t(o as TKey) : o}</option>)}
        </select>
      ) : (
        <input data-col={x.key} data-cell={cellId} aria-label={label} title={tip} value={text} placeholder="—" aria-invalid={state === "error" || undefined}
          type={x.type === "date" ? "date" : "text"} inputMode={x.type === "number" ? (x.integer ? "numeric" : "decimal") : undefined}
          readOnly={state === "saving"} autoComplete="off"
          onFocus={(e) => { focused.current = true; e.target.select(); }}
          onBlur={() => { focused.current = false; void commit(); }}
          onChange={(e) => setText(x.type === "number" ? e.target.value.replace(/[^\d.]/g, "") : e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); moveFocus(e.currentTarget, e.shiftKey ? -1 : 1); }
            else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); moveFocus(e.currentTarget, e.key === "ArrowDown" ? 1 : -1); }
            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setText(savedText); setErr(""); setState("idle"); }
          }}
          className={cn(box, "placeholder:text-r-faint")} />
      )}
      {state === "saving" && <Loader2 className="pointer-events-none absolute top-1/2 right-1 size-3 -translate-y-1/2 animate-spin text-r-muted" aria-hidden />}
      {state === "saved" && <Check className="pointer-events-none absolute top-1/2 right-1 size-3.5 -translate-y-1/2 text-r-accepted" aria-label={t("saved")} />}
    </>
  );
}

/** The small PDF button in the Evidence column. It opens a box with one Upload button (several PDFs / photos at once)
 * and the list of files already attached to this office-day, each opening in a new tab. The state office does not pick
 * a column: files go to the form's file column (see `pdfField` in FormSection). */
function EvidenceButton({ formId, office, files, uploading, onPick }: {
  formId: number; office: string; files: Proof[]; uploading: number; onPick: (files: File[]) => void;
}) {
  const { t } = useT();
  const btn = React.useRef<HTMLButtonElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const [box, setBox] = React.useState<React.CSSProperties | null>(null);
  React.useEffect(() => {
    if (!box) return;
    const inside = (e: Event) => !!(e.target as HTMLElement)?.closest?.("[data-evidence-box]") || btn.current?.contains(e.target as Node);
    const close = (e: Event) => { if (!inside(e)) setBox(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setBox(null); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("scroll", close, true);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("scroll", close, true); document.removeEventListener("keydown", esc, true); };
  }, [box]);

  const toggle = () => {
    if (box) return setBox(null);
    const b = btn.current!.getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 16);
    const left = Math.max(8, Math.min(b.left, window.innerWidth - w - 8));
    // opens below the button, or above it when the button is low on the screen
    setBox(window.innerHeight - b.bottom > 300 ? { top: b.bottom + 6, left, width: w } : { bottom: window.innerHeight - b.top + 6, left, width: w });
  };

  return (
    <>
      <button ref={btn} type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={!!box} translate="no"
        title={t("upload_pdf")} aria-label={`${t("upload_pdf")}: ${office}`}
        className={cn("inline-flex h-6 cursor-pointer items-center gap-0.5 rounded-md border border-r-line px-1.5 text-[11px] font-semibold whitespace-nowrap text-r-muted hover:bg-r-sunk hover:text-r-ink",
          box ? "bg-r-sunk text-r-ink" : "bg-r-card")}>
        {/* same children always (two icons, one label), only their content changes, so a page translator can't leave a
            stale "PDF" behind */}
        <Loader2 className={cn("size-3", uploading > 0 ? "animate-spin" : "hidden")} aria-hidden />
        <Upload className={cn("size-3", uploading > 0 && "hidden")} aria-hidden />
        <span className="num">{files.length ? `PDF · ${files.length}` : "PDF"}</span>
      </button>
      <input ref={input} type="file" multiple hidden accept={FILE_TYPES.join(",")}
        onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ""; if (list.length) onPick(list); }} />
      {box && createPortal(
        <div data-evidence-box role="dialog" aria-label={`${t("upload_pdf")}: ${office}`} style={box}
          className="fixed z-50 flex max-h-[min(420px,70vh)] flex-col gap-2 rounded-xl border border-r-line bg-r-card p-3 text-left shadow-xl">
          <b className="truncate text-sm">{office}</b>
          <RButton size="sm" variant="pri" disabled={uploading > 0} loading={uploading > 0} onClick={() => input.current?.click()}>
            <Upload aria-hidden /> {uploading > 0 ? t("proof_uploading") : t("add_pdf_btn")}
          </RButton>
          <div className="-mx-1 min-h-0 overflow-y-auto px-1 scrollbar-thin">
            {files.length ? <ProofList formId={formId} proofs={files} /> : <p className="m-0 py-1 text-center text-sm text-r-muted">{t("no_pdf_yet")}</p>}
          </div>
        </div>, document.body)}
    </>
  );
}

// --------------------------------------------------------------------------- history log
function HistoryModal({ form, when, byDate, rows, fields, canEdit, busy, onRevert, onOpen, onClose }: {
  form: FormDef; when: string; byDate: boolean; rows: ResponseRow[]; fields: FormField[]; canEdit: boolean; busy: string | null;
  onRevert: (r: ResponseRow, edit: number) => void; onOpen: (r: ResponseRow, key: string) => void; onClose: () => void;
}) {
  const { t, tf, lang } = useT();
  const byKey = (k: string) => fields.find((y) => y.key === k);
  const label = (k: string) => { const x = byKey(k); return x ? fieldLabel(x, lang) : k; };
  const val = (k: string, v: AnswerValue) => { const x = byKey(k); return x ? showValue(x, v, t) : String(v ?? "—"); };
  type Entry = { at: string; who: string; what: string; office: string; tone: "sub" | "ret" | "corr" | "undo" | "save"; note?: string;
    row?: ResponseRow; edit?: ValueEdit; latest?: boolean };
  const log = rows.flatMap((row) => {
    const office = byDate ? `${officeName(row, lang)} · ${periodName(form, row.period_start, lang)}` : officeName(row, lang);
    const latest = new Map(row.edits.map((e) => [e.key, e.id]));
    return [
      row.entered_at && row.entered_at !== row.submitted_at && { at: row.entered_at, who: row.entered_by ?? "", what: t("last_saved"), office, tone: "save" },
      row.submitted_at && { at: row.submitted_at, who: row.submitted_by, what: t("sub_submitted") + (row.late ? ` · ${t("late")}` : ""), office, tone: "sub", note: row.note },
      row.reviewed_at && row.status === "returned" && { at: row.reviewed_at, who: row.reviewed_by, what: t("sub_returned"), office, tone: "ret", note: row.review_note },
      ...row.edits.map((e) => ({ at: e.at, who: e.by, office, tone: e.reverts ? "undo" : e.source === "office" ? "save" : "corr", note: e.note, row, edit: e, latest: latest.get(e.key) === e.id,
        what: tf(e.reverts ? "undone_log" : "edited_log", { f: label(e.key), a: val(e.key, e.before), b: val(e.key, e.after) }) })),
    ].filter(Boolean) as Entry[];
  }).sort((a, b) => b.at.localeCompare(a.at));
  const dot: Record<Entry["tone"], string> = { sub: "bg-r-action", ret: "bg-r-overdue", corr: "bg-r-corrected", undo: "bg-r-field", save: "bg-r-field" };

  return (
    <RSheet open wide onClose={onClose} closeLabel={t("discard")} title={t("history_log")} description={`${formTitle(form, lang)} · ${when}`}>
      {!log.length ? <p className="m-0 text-r-muted">{t("history_empty")}</p> : (
        <ol className="m-0 flex list-none flex-col p-0">
          {log.map((h, i) => (
            <li key={i} className={cn("flex gap-3 py-3", i > 0 && "border-t border-r-sunk")}>
              <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", dot[h.tone])} aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                <span><b>{h.office}</b> · {h.what}</span>
                <span className="text-r-muted">{whenText(h.at, lang)}{h.who ? ` · ${h.who}` : ""}</span>
                {h.note && <span className="rounded-lg bg-r-sunk px-2.5 py-1.5">{h.note}</span>}
              </div>
              {canEdit && h.row && h.edit && (
                <span className="flex shrink-0 items-center gap-1 self-center">
                  {h.latest && !same(h.edit.before, h.row.values[h.edit.key]) && (
                    <RButton size="sm" variant="ghost" disabled={busy === `${h.row.office}:${h.row.period_start}`} onClick={() => onRevert(h.row!, h.edit!.id)}><Undo2 aria-hidden /> {t("undo")}</RButton>
                  )}
                  <RButton size="sm" variant="ghost" onClick={() => onOpen(h.row!, h.edit!.key)}>{t("open_value")}</RButton>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </RSheet>
  );
}

// --------------------------------------------------------------------------- date picker
/** A compact date button that opens a month calendar. `max` is today; days after it, before `min` or after `last` can't be picked.
 *  `iconOnly` draws just the calendar icon; `align` picks which edge the calendar opens from. */
export function DatePicker({ value, max, min = "", last, onChange, iconOnly, align = "right", className }: {
  value: string; max: string; min?: string; last?: string; onChange: (d: string) => void;
  iconOnly?: boolean; align?: "left" | "right"; className?: string;
}) {
  const { t, lang } = useT();
  const [open, setOpen] = React.useState(false);
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const hi = last && last < max ? last : max;
  const ok = (d: string) => d >= min && d <= hi;
  const pick = (d: string) => { onChange(d); setOpen(false); };

  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        aria-label={`${t("date")}: ${dmy(value)}`} title={iconOnly ? shortDay(value, lang) : undefined}
        className={cn("flex h-11 cursor-pointer items-center gap-2 rounded-xl border-0 text-[15px] font-semibold text-r-ink hover:bg-r-sunk", iconOnly ? "w-11 justify-center" : "px-3", open && "bg-r-sunk", className)}>
        <CalendarDays className={cn("size-[18px]", iconOnly ? "text-r-ink" : "text-r-muted")} aria-hidden />
        {!iconOnly && <span className="whitespace-nowrap">{value === max ? t("today") : shortDay(value, lang)}</span>}
        {!iconOnly && <ChevronDown className={cn("size-4 text-r-muted transition-transform", open && "rotate-180")} aria-hidden />}
      </button>
      {open && (
        <div role="dialog" aria-label={t("date")} className={cn("absolute top-full z-40 mt-2 w-[296px] rounded-2xl border border-r-line bg-r-card p-3 shadow-xl", align === "left" ? "left-0" : "right-0")}>
          <MonthCalendar value={value} min={min} max={hi} today={max} onPick={pick} />
          <div className="mt-2 flex justify-between border-t border-r-sunk pt-2">
            <button type="button" className="cursor-pointer rounded-lg border-0 bg-transparent px-2.5 py-1.5 text-[13px] font-semibold text-r-muted hover:bg-r-sunk disabled:cursor-not-allowed disabled:opacity-30" disabled={!ok(addDays(max, -1))} onClick={() => pick(addDays(max, -1))}>{t("yesterday")}</button>
            <button type="button" className="cursor-pointer rounded-lg border-0 bg-transparent px-2.5 py-1.5 text-[13px] font-semibold text-r-action hover:bg-r-sunk disabled:cursor-not-allowed disabled:opacity-30" disabled={!ok(max)} onClick={() => pick(max)}>{t("today")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
