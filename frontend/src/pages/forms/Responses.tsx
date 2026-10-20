import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, FileSpreadsheet, X } from "lucide-react";
import { api, ApiError, type AnswerValue, type FormDef, type FormField, type ResponseRow } from "@/lib/api";
import { useT, type TKey } from "@/lib/i18n";
import { addDays, cn } from "@/lib/utils";
import { RButton, RError, RInput, RLabel, RPage, RSearch, RSheet, RTitle } from "@/components/reports/kit";
import { fig, periodOf, timeOf, whenText } from "@/components/reports/period";
import { fieldLabel, formTitle, useFormFilters } from "./common";
import { periodName, useResponses } from "../office/shared";

const SENT = ["submitted", "accepted", "returned"];

export function showValue(f: FormField, v: AnswerValue, t: (k: TKey) => string) {
  if (v === null || v === undefined || v === "") return "—";
  if (f.type === "yesno") return v === "yes" ? t("yes") : t("no");
  return typeof v === "number" ? fig(v) : String(v);
}

export const officeName = (r: ResponseRow, lang: string) => (lang === "en" && r.office_name_en ? r.office_name_en : r.office_name_mr);

/** Table spelling: "Divisional Information Office, Pune" → "Div. Pune", "Chhatrapati" → "Chh." (as the Marathi "विमाका, छ."). */
export const shortOffice = (r: ResponseRow, lang: string) => officeName(r, lang)
  .replace(/^Divisional Information Office,?\s*/i, "Div. ")
  .replace(/^Headquarters,?\s*/i, "HQ ")
  .replace(/\bChhatrapati\s+/g, "Chh. ")
  .replace(/^(विमाका|मुख्यालय),?\s*/, "$1 ");
const norm = (s: string) => s.toLocaleLowerCase().trim();

/** Forms that have a period on `day`, newest first. */
export function formsOn(forms: FormDef[], day: string) {
  return forms
    .filter((x) => (x.status === "published" || x.status === "closed") && x.start_date <= day && (!x.end_date || day <= x.end_date))
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
}

export default function ResponsesPage() {
  const { t, tf } = useT();
  const f = useFormFilters();
  const day = f.params.get("day") || f.today;
  const q = f.params.get("q") || "";
  const forms = React.useMemo(() => (f.forms && day ? formsOn(f.forms, day) : []), [f.forms, day]);

  // sections opened by hand; while searching, matching sections open unless closed by hand.
  // A link that names a form (?form=, e.g. Review on the desk) opens that section.
  const target = Number(f.params.get("form")) || 0;
  const [opened, setOpened] = React.useState<Set<number>>(() => new Set(target ? [target] : []));
  const [closed, setClosed] = React.useState<Set<number>>(new Set());
  React.useEffect(() => setClosed(new Set()), [q]);
  const isOpen = (id: number) => (q.trim() ? !closed.has(id) : opened.has(id));
  const toggle = (id: number) => {
    const flip = (s: Set<number>) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; };
    if (q.trim()) setClosed(flip); else setOpened(flip);
  };

  // each section reports how many rows match the search, so we can say when nothing does
  const [hits, setHits] = React.useState<Record<number, number>>({});
  const onHits = React.useCallback((id: number, n: number) => setHits((h) => (h[id] === n ? h : { ...h, [id]: n })), []);
  const noMatch = !!q.trim() && forms.length > 0 && forms.every((x) => hits[x.id] === 0);

  return (
    <RPage>
      <RTitle title={t("nav_responses")} />

      <RSearch value={q} placeholder={t("resp_search")} onChange={(v) => f.set({ q: v || null })}>
        <DatePicker value={day} max={f.today} onChange={(d) => f.set({ day: d === f.today ? null : d })} />
      </RSearch>

      <div className="mt-5 flex flex-col gap-3">
        {!f.forms ? <div className="h-40 animate-pulse rounded-2xl bg-r-sunk" />
          : !forms.length ? <p className="m-0 rounded-2xl bg-r-card p-5 text-r-muted">{t("no_forms")}</p>
          : forms.map((x) => (
            <FormSection key={x.id} form={x} day={day} division="" q={q} open={isOpen(x.id)} focus={x.id === target} onToggle={() => toggle(x.id)} onHits={onHits} />
          ))}
        {noMatch && <p className="m-0 rounded-2xl bg-r-card p-5 text-r-muted">{tf("resp_no_match", { q: q.trim() })}</p>}
      </div>
    </RPage>
  );
}

// --------------------------------------------------------------------------- one form, as a dropdown
function FormSection({ form, day, division, q, open, focus, onToggle, onHits }: {
  form: FormDef; day: string; division: string; q: string; open: boolean; focus: boolean; onToggle: () => void; onHits: (id: number, n: number) => void;
}) {
  const { t, tf, lang } = useT();
  const box = React.useRef<HTMLElement>(null);
  React.useEffect(() => { if (focus) box.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [focus]);
  const qc = useQueryClient();
  const ps = periodOf(form, day);
  const { data, error, isLoading, isFetching } = useResponses(form.id, ps, ps, division);
  const fields = (data?.form.fields ?? []).filter((x) => !x.archived);
  const review = data?.can_review ?? false;
  const all = React.useMemo(() => (data?.rows ?? []).filter((r) => r.period_start === ps), [data, ps]);

  // a form whose title matches shows all its offices; otherwise only matching offices
  const needle = norm(q);
  const rows = React.useMemo(() => {
    if (!needle || norm(form.title_mr).includes(needle) || norm(form.title_en).includes(needle)) return all;
    return all.filter((r) => [r.office_name_mr, r.office_name_en, r.office].some((s) => norm(s ?? "").includes(needle)));
  }, [all, needle, form]);
  React.useEffect(() => { if (data) onHits(form.id, rows.length); }, [data, rows.length, form.id, onHits]);

  const [busy, setBusy] = React.useState<string | null>(null);
  const [rejecting, setRejecting] = React.useState<ResponseRow | null>(null);
  const [note, setNote] = React.useState("");
  const [showLog, setShowLog] = React.useState(false);
  const noteRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (rejecting) noteRef.current?.focus(); }, [rejecting]);

  const base = (r: ResponseRow) => `/api/forms/${form.id}/submissions/${r.office}/${r.period_start}`;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["responses"] }); qc.invalidateQueries({ queryKey: ["compliance"] }); };
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : String(e));

  const accept = async (r: ResponseRow) => {
    setBusy(r.office);
    try { await api.post(`${base(r)}/accept`); toast.success(t("sub_accepted")); if (rejecting === r) setRejecting(null); refresh(); }
    catch (e) { fail(e); } finally { setBusy(null); }
  };
  const reject = async () => {
    if (!rejecting) return;
    if (!note.trim()) { noteRef.current?.focus(); toast.error(t("return_needs_note")); return; }
    setBusy(rejecting.office);
    try { await api.post(`${base(rejecting)}/return`, { note: note.trim() }); toast.success(t("sub_returned")); setRejecting(null); setNote(""); refresh(); }
    catch (e) { fail(e); } finally { setBusy(null); }
  };
  const queue = rows.filter((r) => r.status === "submitted");
  const acceptAll = async () => {
    setBusy("*");
    const res = await Promise.allSettled(queue.map((r) => api.post(`${base(r)}/accept`)));
    const ok = res.filter((x) => x.status === "fulfilled").length;
    if (ok) toast.success(tf("accepted_n", { n: ok }));
    res.forEach((x) => x.status === "rejected" && fail(x.reason));
    setBusy(null);
    refresh();
  };

  if (q.trim() && data && !rows.length) return null;
  const sent = all.filter((r) => SENT.includes(r.status)).length;
  const toReview = all.filter((r) => r.status === "submitted").length;
  const bodyId = `form-${form.id}`;

  return (
    <section ref={box} className="scroll-mt-4 overflow-hidden rounded-2xl border border-r-line bg-r-card">
      <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-5 py-4 text-left text-r-ink hover:bg-r-ground">
        <ChevronDown className={cn("size-5 shrink-0 text-r-muted transition-transform", !open && "-rotate-90")} aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-[17px]">{formTitle(form, lang)}</b>
          <span className="text-[13px] text-r-muted">{periodName(form, ps, lang)}</span>
        </span>
        {data && <span className="num shrink-0 text-[13px] text-r-muted">{tf("resp_counts", { a: sent, b: all.length, r: toReview })}</span>}
      </button>

      {open && (
        <div id={bodyId} className="border-t border-r-line">
          {error ? <div className="p-4"><RError error={error} /></div> : isLoading || !data ? <div className="m-4 h-40 animate-pulse rounded-xl bg-r-sunk" /> : !rows.length ? (
            <p className="m-0 p-5 text-r-muted">{t("resp_no_rows")}</p>
          ) : (
            <div className={cn("max-h-[70vh] overflow-y-auto scrollbar-thin transition-opacity", isFetching && "opacity-60")}>
              <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
                <colgroup>
                  <col className="w-[148px]" />
                  <col className="w-[64px]" />
                  {fields.map((x) => <col key={x.key} />)}
                  {review && <col className="w-[84px]" />}
                </colgroup>
                <thead className="sticky top-0 z-20">
                  <tr>
                    <th scope="col" className="sticky left-0 z-30 border-b border-r-line bg-r-card px-3 py-2 text-left align-bottom text-xs font-bold text-r-muted">{t("office")}</th>
                    <th scope="col" className="border-b border-r-line bg-r-card px-1.5 py-2 text-left align-bottom text-xs font-bold text-r-muted first-letter:uppercase">{t("sent")}</th>
                    {fields.map((x) => <th key={x.key} scope="col" title={fieldLabel(x, lang)} className="border-b border-r-line bg-r-card px-1.5 py-2 text-right align-bottom text-[11px] leading-tight font-bold break-words hyphens-auto text-r-muted">{fieldLabel(x, lang)}</th>)}
                    {review && <th scope="col" className="sticky right-0 z-30 border-b border-r-line bg-r-card px-2 py-2"><span className="sr-only">{t("status")}</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Row key={r.office} r={r} fields={fields} review={review} busy={busy === r.office || busy === "*"} rejecting={rejecting === r}
                      onAccept={() => accept(r)} onReject={() => { setRejecting(rejecting === r ? null : r); setNote(""); }} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && rows.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-r-line px-4 py-3">
              {review && rejecting && (
                <div className="flex flex-wrap items-end gap-2.5">
                  <RLabel small label={tf("note_to", { o: officeName(rejecting, lang) })} className="min-w-60 flex-1">
                    <RInput ref={noteRef} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("return_note")}
                      onKeyDown={(e) => { if (e.key === "Enter") void reject(); else if (e.key === "Escape") setRejecting(null); }} />
                  </RLabel>
                  <RButton variant="ghost" onClick={() => setRejecting(null)}>{t("discard")}</RButton>
                  <RButton className="border-r-overdue bg-r-overdue text-white hover:bg-r-overdue-ink dark:text-r-ground" loading={busy === rejecting.office} onClick={reject}>
                    <X aria-hidden /> {t("reject")}
                  </RButton>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <RButton asChild size="sm" variant="ghost">
                  <a href={`/api/forms/${form.id}/export?start=${ps}&end=${ps}${division ? `&division=${division}` : ""}`} download><FileSpreadsheet aria-hidden /> {t("export_workbook")}</a>
                </RButton>
                <span className="flex items-center gap-2">
                <RButton variant="ghost" className="px-2.5" aria-label={t("history_log")} title={t("history_log")} onClick={() => setShowLog(true)}>
                  <Clock aria-hidden />
                </RButton>
                {review && (
                  <RButton className="border-r-accepted bg-r-accepted text-white hover:bg-r-accepted/90 dark:text-r-ground" disabled={!queue.length} loading={busy === "*"} onClick={acceptAll}>
                    <Check aria-hidden /> {tf("accept_all", { n: queue.length })}
                  </RButton>
                )}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {showLog && data && <HistoryModal form={data.form} period={ps} rows={all} fields={fields} onClose={() => setShowLog(false)} />}
    </section>
  );
}

function Row({ r, fields, review, busy, rejecting, onAccept, onReject }: {
  r: ResponseRow; fields: FormField[]; review: boolean; busy: boolean; rejecting: boolean; onAccept: () => void; onReject: () => void;
}) {
  const { t, lang } = useT();
  const sent = SENT.includes(r.status);
  const bg = rejecting || r.status === "returned" ? "bg-r-overdue-soft" : sent ? "bg-r-accepted-soft" : "bg-r-card";
  const iconBtn = "flex size-8 cursor-pointer items-center justify-center rounded-full border-[1.5px] disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <tr className={bg}>
      <th scope="row" className={cn("sticky left-0 z-10 border-b border-r-line-soft px-3 py-1.5 text-left font-medium whitespace-nowrap", bg)}>
        <span title={officeName(r, lang)} className="block truncate">{shortOffice(r, lang)}</span>
      </th>
      <td className={cn("truncate border-b border-r-line-soft px-1.5 py-1.5 text-xs whitespace-nowrap", sent ? "text-r-muted" : "text-r-overdue-ink")}>
        {sent && r.submitted_at ? (r.submitted_at.slice(0, 10) <= r.period_end ? timeOf(r.submitted_at, lang) : whenText(r.submitted_at, lang)) : r.status === "draft" ? t("sub_draft") : t("sub_none")}
      </td>
      {fields.map((x) => {
        const v = r.values[x.key];
        const c = r.corrections[x.key];
        return (
          <td key={x.key} title={c ? `${t("corrected")} · ${t("original")}: ${c.original ?? "—"}${c.note ? ` · ${c.note}` : ""}` : undefined}
            className={cn("num truncate border-b border-r-line-soft px-1.5 py-1.5 text-right", !sent && "text-r-faint")}>
            {c ? <span className="corr">{showValue(x, v, t)}</span> : !sent && r.status !== "draft" ? "—" : showValue(x, v, t)}
          </td>
        );
      })}
      {review && <td className={cn("sticky right-0 z-10 border-b border-r-line-soft px-2 py-1", bg)}>
        <span className="flex items-center justify-end gap-1.5">
          {sent && (
            <>
              <button type="button" onClick={onAccept} disabled={busy || r.status === "accepted"} aria-label={t("accept")} title={t("accept")} aria-pressed={r.status === "accepted"}
                className={cn(iconBtn, r.status === "accepted" ? "border-r-accepted bg-r-accepted text-white disabled:opacity-100" : "border-r-accepted bg-r-card text-r-accepted hover:bg-r-accepted hover:text-white")}>
                <Check className="size-4" aria-hidden />
              </button>
              <button type="button" onClick={onReject} disabled={busy || r.status === "returned"} aria-label={t("reject")} title={t("reject")} aria-pressed={r.status === "returned" || rejecting}
                className={cn(iconBtn, r.status === "returned" || rejecting ? "border-r-overdue bg-r-overdue text-white disabled:opacity-100" : "border-r-overdue bg-r-card text-r-overdue hover:bg-r-overdue hover:text-white")}>
                <X className="size-4" aria-hidden />
              </button>
            </>
          )}
        </span>
      </td>}
    </tr>
  );
}

// --------------------------------------------------------------------------- history log
function HistoryModal({ form, period, rows, fields, onClose }: { form: FormDef; period: string; rows: ResponseRow[]; fields: FormField[]; onClose: () => void }) {
  const { t, tf, lang } = useT();
  const label = (k: string) => { const x = fields.find((y) => y.key === k); return x ? fieldLabel(x, lang) : k; };
  type Entry = { at: string; who: string; what: string; office: string; tone: "sub" | "acc" | "ret" | "corr" | "save"; note?: string };
  const log = rows.flatMap((row) => {
    const office = officeName(row, lang);
    return [
      row.entered_at && row.entered_at !== row.submitted_at && { at: row.entered_at, who: row.entered_by ?? "", what: t("last_saved"), office, tone: "save" },
      row.submitted_at && { at: row.submitted_at, who: row.submitted_by, what: t("sub_submitted") + (row.late ? ` · ${t("late")}` : ""), office, tone: "sub", note: row.note },
      row.reviewed_at && { at: row.reviewed_at, who: row.reviewed_by, what: row.status === "returned" ? t("sub_returned") : t("sub_accepted"), office, tone: row.status === "returned" ? "ret" : "acc", note: row.status === "returned" ? row.review_note : "" },
      ...Object.entries(row.corrections).map(([k, c]) => ({ at: c.at, who: c.by, what: tf("corrected_log", { f: label(k), a: c.original ?? "—", b: row.values[k] ?? "—" }), office, tone: "corr", note: c.note })),
    ].filter(Boolean) as Entry[];
  }).sort((a, b) => b.at.localeCompare(a.at));
  const dot: Record<Entry["tone"], string> = { sub: "bg-r-action", acc: "bg-r-accepted", ret: "bg-r-overdue", corr: "bg-r-corrected", save: "bg-r-field" };

  return (
    <RSheet open wide onClose={onClose} closeLabel={t("discard")} title={t("history_log")} description={`${formTitle(form, lang)} · ${periodName(form, period, lang)}`}>
      {!log.length ? <p className="m-0 text-r-muted">{t("history_empty")}</p> : (
        <ol className="m-0 flex list-none flex-col p-0">
          {log.map((h, i) => (
            <li key={i} className={cn("flex gap-3 py-3", i > 0 && "border-t border-r-sunk")}>
              <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", dot[h.tone])} aria-hidden />
              <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                <span><b>{h.office}</b> · {h.what}</span>
                <span className="text-r-muted">{whenText(h.at, lang)}{h.who ? ` · ${h.who}` : ""}</span>
                {h.note && <span className="rounded-lg bg-r-sunk px-2.5 py-1.5">{h.note}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </RSheet>
  );
}

// --------------------------------------------------------------------------- date picker
const loc = (lang: string) => (lang === "mr" ? "mr-IN" : "en-IN");
const utc = (iso: string) => new Date(iso + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** A compact date button that opens a month calendar. `max` is today; days after it, before `min` or after `last` can't be picked.
 *  `iconOnly` draws just the calendar icon; `align` picks which edge the calendar opens from. */
export function DatePicker({ value, max, min = "", last, onChange, iconOnly, align = "right", className }: {
  value: string; max: string; min?: string; last?: string; onChange: (d: string) => void;
  iconOnly?: boolean; align?: "left" | "right"; className?: string;
}) {
  const { t, lang } = useT();
  const [open, setOpen] = React.useState(false);
  const [shown, setMonth] = React.useState(value.slice(0, 7));
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { setMonth(value.slice(0, 7)); }, [open, value]);
  // `value` may arrive after mount, before the effect above has synced `shown`
  const month = /^\d{4}-\d{2}$/.test(shown) ? shown : value.slice(0, 7);
  React.useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  // six weeks starting on the Monday on or before the 1st
  const first = utc(month + "-01");
  const lead = (first.getUTCDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => addDays(iso(first), i - lead));
  const shift = (n: number) => { const d = utc(month + "-01"); d.setUTCMonth(d.getUTCMonth() + n); setMonth(iso(d).slice(0, 7)); };
  const hi = last && last < max ? last : max;
  const ok = (d: string) => d >= min && d <= hi;
  const prevOk = !min || month > min.slice(0, 7);
  const nextOk = month < hi.slice(0, 7);
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => utc(d).toLocaleDateString(loc(lang), { timeZone: "UTC", ...o });
  const pick = (d: string) => { onChange(d); setOpen(false); };
  const nav = "flex size-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-r-ink hover:bg-r-sunk disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        aria-label={`${t("date")}: ${fmt(value, { day: "numeric", month: "long", year: "numeric" })}`} title={iconOnly ? fmt(value, { weekday: "short", day: "numeric", month: "short" }) : undefined}
        className={cn("flex h-11 cursor-pointer items-center gap-2 rounded-xl border-0 text-[15px] font-semibold text-r-ink hover:bg-r-sunk", iconOnly ? "w-11 justify-center" : "px-3", open && "bg-r-sunk", className)}>
        <CalendarDays className={cn("size-[18px]", iconOnly ? "text-r-ink" : "text-r-muted")} aria-hidden />
        {!iconOnly && <span className="whitespace-nowrap">{value === max ? t("today") : fmt(value, { weekday: "short", day: "numeric", month: "short" })}</span>}
        {!iconOnly && <ChevronDown className={cn("size-4 text-r-muted transition-transform", open && "rotate-180")} aria-hidden />}
      </button>
      {open && (
        <div role="dialog" aria-label={t("date")} className={cn("absolute top-full z-40 mt-2 w-[296px] rounded-2xl border border-r-line bg-r-card p-3 shadow-xl", align === "left" ? "left-0" : "right-0")}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" className={nav} aria-label={t("earlier")} disabled={!prevOk} onClick={() => shift(-1)}><ChevronLeft className="size-4" /></button>
            <b className="text-[15px]">{fmt(month + "-01", { month: "long", year: "numeric" })}</b>
            <button type="button" className={nav} aria-label={t("later")} disabled={!nextOk} onClick={() => shift(1)}><ChevronRight className="size-4" /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {days.slice(0, 7).map((d) => <span key={d} className="py-1 text-[11px] font-bold text-r-faint uppercase">{fmt(d, { weekday: "narrow" })}</span>)}
            {days.map((d) => {
              const inMonth = d.slice(0, 7) === month;
              const sel = d === value;
              const isToday = d === max;
              return (
                <button key={d} type="button" disabled={!ok(d)} onClick={() => pick(d)} aria-pressed={sel} aria-label={fmt(d, { day: "numeric", month: "long", year: "numeric" })}
                  className={cn("num relative flex h-9 cursor-pointer items-center justify-center rounded-lg border-0 text-sm disabled:cursor-not-allowed disabled:opacity-25",
                    sel ? "bg-r-action font-bold text-white" : "bg-transparent hover:bg-r-sunk",
                    !sel && (inMonth ? "text-r-ink" : "text-r-faint"),
                    isToday && !sel && "font-bold text-r-action ring-1 ring-r-action ring-inset")}>
                  {fmt(d, { day: "numeric" })}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between border-t border-r-sunk pt-2">
            <button type="button" className="cursor-pointer rounded-lg border-0 bg-transparent px-2.5 py-1.5 text-[13px] font-semibold text-r-muted hover:bg-r-sunk disabled:cursor-not-allowed disabled:opacity-30" disabled={!ok(addDays(max, -1))} onClick={() => pick(addDays(max, -1))}>{t("yesterday")}</button>
            <button type="button" className="cursor-pointer rounded-lg border-0 bg-transparent px-2.5 py-1.5 text-[13px] font-semibold text-r-action hover:bg-r-sunk disabled:cursor-not-allowed disabled:opacity-30" disabled={!ok(max)} onClick={() => pick(max)}>{t("today")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
