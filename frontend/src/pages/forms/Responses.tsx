import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, CalendarDays, ChevronDown, Clock, FileSpreadsheet, RotateCcw, Undo2 } from "lucide-react";
import { api, ApiError, backendUrl, type AnswerValue, type FormDef, type FormField, type ResponseRow, type Submission, type ValueEdit } from "@/lib/api";
import { useT, type TKey } from "@/lib/i18n";
import { addDays, cn, dmy } from "@/lib/utils";
import { RButton, RError, RInput, RLabel, RPage, RSearch, RSelect, RSheet, RTextarea, RTitle } from "@/components/reports/kit";
import { fig, periodOf, rangeText, shortDay, stepOf, timeOf, whenText } from "@/components/reports/period";
import { MonthCalendar } from "@/components/reports/DateInput";
import { fieldLabel, formTitle, useFormFilters } from "./common";
import { periodName, useResponses } from "../office/shared";

const SENT = ["submitted", "returned"];

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
const norm = (s: string) => s.toLocaleLowerCase().trim();

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

      <RSearch value={q} placeholder={t("resp_search")} onChange={(v) => f.set({ q: v || null })} />

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
                  <FormSection key={x.id} form={x} today={today} day={x.id === target ? targetDay : null} division="" q={q}
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

// --------------------------------------------------------------------------- one form, as a dropdown
/** All dates by default; the calendar inside narrows the dropdown to one date. */
function FormSection({ form, today, day, division, q, open, focus, onToggle, onHits }: {
  form: FormDef; today: string; day: string | null; division: string; q: string; open: boolean; focus: boolean;
  onToggle: () => void; onHits: (id: number, n: number) => void;
}) {
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
  const { data, error, isLoading, isFetching } = useResponses(form.id, start, end, division);
  const fields = (data?.form.fields ?? []).filter((x) => !x.archived);
  const canEdit = data?.can_review ?? false;
  const all = React.useMemo(() => (data?.rows ?? []).filter((r) => r.period_start >= start && r.period_start <= end), [data, start, end]);

  // a form whose title matches shows all its offices; otherwise only matching offices
  const needle = norm(q);
  const rows = React.useMemo(() => {
    if (!needle || norm(form.title_mr).includes(needle) || norm(form.title_en).includes(needle)) return all;
    return all.filter((r) => [r.office_name_mr, r.office_name_en, r.office].some((s) => norm(s ?? "").includes(needle)));
  }, [all, needle, form]);
  React.useEffect(() => { if (data) onHits(form.id, rows.length); }, [data, rows.length, form.id, onHits]);

  // as in a spreadsheet: a header click sorts high → low (offices A → Z), each further click reverses it
  const [sort, setSort] = React.useState<Sort | null>(null);
  const sortBy = (key: string) => setSort((s) => (s?.key === key
    ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
    : { key, dir: key === OFFICE ? "asc" : "desc" }));

  // newest date first, each date under its own band; the sort applies within each band
  const groups = React.useMemo(() => {
    if (!byDate) return [{ ps: "", rows: sortRows(rows, sort, fields, lang) }];
    const m = new Map<string, ResponseRow[]>();
    rows.forEach((r) => m.set(r.period_start, [...(m.get(r.period_start) ?? []), r]));
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([p, rs]) => ({ ps: p, rows: sortRows(rs, sort, fields, lang) }));
  }, [rows, byDate, sort, fields, lang]);

  const [busy, setBusy] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ id: string; key: string } | null>(null);
  const [showLog, setShowLog] = React.useState(false);

  const rowId = (r: ResponseRow) => `${r.office}:${r.period_start}`;
  const base = (r: ResponseRow) => `/api/forms/${form.id}/submissions/${r.office}/${r.period_start}`;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["responses"] }); qc.invalidateQueries({ queryKey: ["compliance"] }); };
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : String(e));

  const revert = async (r: ResponseRow, edit: number) => {
    setBusy(rowId(r));
    try { await api.post(`${base(r)}/revert`, { edit_id: edit }); toast.success(t("value_restored")); refresh(); }
    catch (e) { fail(e); } finally { setBusy(null); }
  };
  const save = async (r: ResponseRow, key: string, value: string, note: string) => {
    setBusy(rowId(r));
    try {
      const out = await api.post<Submission>(`${base(r)}/correct`, { key, value: value.trim() || null, note });
      const last = out.edits.at(-1);
      toast.success(t("value_saved"), last ? { action: { label: t("undo"), onClick: () => void revert(r, last.id) } } : undefined);
      setEditing(null);
      refresh();
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  if (q.trim() && data && !rows.length) return null;
  const sent = all.filter((r) => SENT.includes(r.status)).length;
  const edited = all.filter((r) => Object.keys(r.corrections).length > 0).length;
  const bodyId = `form-${form.id}`;
  const editRow = editing && all.find((r) => rowId(r) === editing.id);
  const editField = editing && fields.find((x) => x.key === editing.key);
  const when = byDate ? `${t("zb_all_dates")} · ${rangeText(start, end, lang)}` : periodName(form, ps, lang);

  return (
    <section ref={box} className="scroll-mt-4 rounded-2xl border border-r-line bg-r-card">
      <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}
        className={cn("flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-5 py-4 text-left text-r-ink hover:bg-r-ground", open ? "rounded-t-2xl" : "rounded-2xl")}>
        <ChevronDown className={cn("size-5 shrink-0 text-r-muted transition-transform", !open && "-rotate-90")} aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-[17px]">{formTitle(form, lang)}</b>
          <span className="text-[13px] text-r-muted">{when}</span>
        </span>
        {data && <span className="num shrink-0 text-[13px] text-r-muted">{tf("resp_counts", { a: sent, b: all.length })}{edited > 0 && ` · ${tf("resp_edited", { n: edited })}`}</span>}
      </button>

      {open && (
        <div id={bodyId} className="border-t border-r-line">
          {!once && (
            <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-1">
              <button type="button" aria-pressed={byDate} onClick={() => setSel(null)}
                className={cn("inline-flex h-11.75 cursor-pointer items-center rounded-xl border-[1.5px] px-4 text-[15px] font-semibold",
                  byDate ? "border-r-ink bg-r-ink text-r-card" : "border-r-line bg-r-card text-r-ink hover:bg-r-sunk")}>
                {t("zb_all_dates")}
              </button>
              <span className={cn("rounded-xl border-[1.5px]", !byDate ? "border-r-ink" : "border-r-line")}>
                <DatePicker align="left" value={sel ?? range.end} max={today} min={form.start_date} last={form.end_date ?? undefined} onChange={setSel}
                  className={byDate ? "text-r-muted" : undefined} />
              </span>
            </div>
          )}
          {error ? <div className="p-4"><RError error={error} /></div> : isLoading || !data ? <div className="m-4 h-40 animate-pulse rounded-xl bg-r-sunk" /> : !rows.length ? (
            <p className="m-0 p-5 text-r-muted">{t("resp_no_rows")}</p>
          ) : (
            <div className={cn("max-h-[70vh] overflow-auto scrollbar-thin transition-opacity", isFetching && "opacity-60")}>
              {/* on a narrow screen the value columns keep a readable width and the grid scrolls sideways */}
              <table className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{ minWidth: 112 + 64 + fields.length * 80 }}>
                <colgroup>
                  <col className="w-[112px] md:w-[148px]" />
                  <col className="w-[64px]" />
                  {fields.map((x) => <col key={x.key} />)}
                </colgroup>
                <thead className="sticky top-0 z-20">
                  <tr>
                    <SortHead col={OFFICE} label={t("office")} sort={sort} onSort={sortBy} className="sticky left-0 z-30 pl-1.5 text-xs" />
                    <SortHead col={SENT_COL} label={t("sent")} sort={sort} onSort={sortBy} className="px-0 text-xs first-letter:uppercase" />
                    {fields.map((x) => <SortHead key={x.key} col={x.key} label={fieldLabel(x, lang)} sort={sort} onSort={sortBy} right
                      className="px-0.5 text-[11px] leading-tight break-words hyphens-auto" />)}
                  </tr>
                </thead>
                {groups.map((g) => (
                  <tbody key={g.ps || "one"}>
                    {byDate && (
                      <tr>
                        <th scope="colgroup" colSpan={fields.length + 2} className="sticky left-0 border-b border-r-line bg-r-sunk px-3 py-1.5 text-left text-[13px]">
                          <span className="font-bold">{periodName(form, g.ps, lang)}</span>
                          <span className="num ml-2 font-normal text-r-muted">{tf("resp_counts", { a: g.rows.filter((r) => SENT.includes(r.status)).length, b: g.rows.length })}</span>
                        </th>
                      </tr>
                    )}
                    {g.rows.map((r) => (
                      <Row key={rowId(r)} r={r} fields={fields} canEdit={canEdit} editing={editing?.id === rowId(r) ? editing.key : null}
                        onEdit={(key) => setEditing({ id: rowId(r), key })} />
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
                {canEdit && <span className="hidden text-[13px] text-r-muted md:inline">{t("click_to_edit")}</span>}
                <RButton variant="ghost" size="sm" onClick={() => setShowLog(true)}>
                  <Clock aria-hidden /> {t("history_log")}
                </RButton>
              </span>
            </div>
          )}
        </div>
      )}

      {editRow && editField && (
        <EditSheet key={`${rowId(editRow)}:${editField.key}`} form={form} row={editRow} field={editField} busy={busy === rowId(editRow)}
          onSave={(v, note) => save(editRow, editField.key, v, note)} onRevert={(id) => revert(editRow, id)} onClose={() => setEditing(null)} />
      )}
      {showLog && data && (
        <HistoryModal form={data.form} when={when} byDate={byDate} rows={all} fields={fields} canEdit={canEdit} busy={busy}
          onRevert={revert} onOpen={(r, key) => { setShowLog(false); setEditing({ id: rowId(r), key }); }} onClose={() => setShowLog(false)} />
      )}
    </section>
  );
}

/** A column heading that sorts the table when clicked, with an arrow showing the current direction. */
function SortHead({ col, label, sort, onSort, right, className }: {
  col: string; label: string; sort: Sort | null; onSort: (key: string) => void; right?: boolean; className?: string;
}) {
  const { tf } = useT();
  const dir = sort?.key === col ? sort.dir : null;
  const Arrow = dir === "asc" ? ArrowUp : ArrowDown;
  // the button fills the whole cell (h-px on the cell lets h-full reach its height), so a click anywhere in a tall heading
  // sorts; the sorted column is tinted, distinct from the hover, so the first click visibly takes
  return (
    <th scope="col" aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
      className={cn("h-px border-b border-r-line bg-r-card p-1 align-bottom font-bold", className)}>
      <button type="button" onClick={() => onSort(col)} title={tf("sort_by", { f: label })}
        className={cn("group flex h-full w-full cursor-pointer items-end gap-1 rounded-lg border-0 px-1.5 py-1.5 font-[inherit] leading-[inherit] select-none",
          right ? "justify-end text-right" : "text-left",
          dir ? "bg-r-action-soft text-r-action" : "bg-transparent text-r-muted hover:bg-r-sunk hover:text-r-ink")}>
        <span className="min-w-0">{label}</span>
        <Arrow className={cn("mb-px size-3 shrink-0", dir ? "opacity-100" : "opacity-0 group-hover:opacity-50")} aria-hidden />
      </button>
    </th>
  );
}

function Row({ r, fields, canEdit, editing, onEdit }: {
  r: ResponseRow; fields: FormField[]; canEdit: boolean; editing: string | null; onEdit: (key: string) => void;
}) {
  const { t, lang } = useT();
  const sent = SENT.includes(r.status);
  const bg = r.status === "returned" ? "bg-r-overdue-soft" : sent ? "bg-r-accepted-soft" : "bg-r-card";
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
        const shown = c ? <span className="corr">{showValue(x, v, t)}</span> : !sent && r.status !== "draft" ? "—" : showValue(x, v, t);
        const tip = c ? `${t("corrected")} · ${t("original")}: ${c.original ?? "—"}${c.note ? ` · ${c.note}` : ""}` : undefined;
        return (
          <td key={x.key} className={cn("num truncate border-b border-r-line-soft text-right", !sent && "text-r-faint", canEdit ? "p-0.5" : "px-1.5 py-1.5")}>
            {canEdit ? (
              <button type="button" onClick={() => onEdit(x.key)} title={tip ?? t("edit_value")} aria-label={`${t("edit_value")}: ${fieldLabel(x, lang)}, ${officeName(r, lang)}`}
                className={cn("num block w-full cursor-pointer truncate rounded-md border-0 bg-transparent px-1 py-1 text-right text-sm hover:bg-r-card hover:text-r-ink hover:ring-1 hover:ring-r-line",
                  sent ? "text-r-ink" : "text-r-faint", editing === x.key && "bg-r-card ring-2 ring-r-action")}>
                {shown}
              </button>
            ) : <span title={tip}>{shown}</span>}
          </td>
        );
      })}
    </tr>
  );
}

// --------------------------------------------------------------------------- editing one value
/** One field's edits, newest first. */
const editsOf = (r: ResponseRow, key: string) => r.edits.filter((e) => e.key === key).reverse();
const same = (a: AnswerValue | undefined, b: AnswerValue | undefined) => (a ?? "") === (b ?? "");
const asText = (v: AnswerValue | undefined) => (v === null || v === undefined ? "" : String(v));

function EditSheet({ form, row, field, busy, onSave, onRevert, onClose }: {
  form: FormDef; row: ResponseRow; field: FormField; busy: boolean;
  onSave: (value: string, note: string) => void; onRevert: (edit: number) => void; onClose: () => void;
}) {
  const { t, tf, lang } = useT();
  const cur = row.values[field.key];
  const [value, setValue] = React.useState(asText(cur));
  const [note, setNote] = React.useState("");
  const changed = value.trim() !== asText(cur);
  const c = row.corrections[field.key];
  const edits = editsOf(row, field.key);
  const sentValue = edits.length ? edits[edits.length - 1].before : SENT.includes(row.status) ? cur : null;
  const show = (v: AnswerValue) => showValue(field, v, t);
  const submit = (e?: React.FormEvent) => { e?.preventDefault(); if (changed && !busy) onSave(value, note.trim()); };

  const input = field.type === "yesno" || field.type === "choice" ? (
    <RSelect value={value} onChange={(e) => setValue(e.target.value)} className="min-h-[54px] w-full rounded-xl text-base">
      <option value="">—</option>
      {(field.type === "yesno" ? ["yes", "no"] : field.options).map((o) => <option key={o} value={o}>{field.type === "yesno" ? t(o as TKey) : o}</option>)}
    </RSelect>
  ) : field.type === "text" ? <RTextarea value={value} onChange={(e) => setValue(e.target.value)} className="text-base" />
    : <RInput big autoFocus type={field.type === "date" ? "date" : "text"} inputMode={field.type === "number" ? "decimal" : undefined} value={value} onChange={(e) => setValue(e.target.value)} />;

  return (
    <RSheet open onClose={onClose} closeLabel={t("discard")} title={fieldLabel(field, lang)} description={`${officeName(row, lang)} · ${periodName(form, row.period_start, lang)}`}
      footer={
        <div className="flex justify-end gap-2.5">
          <RButton variant="ghost" onClick={onClose}>{t("discard")}</RButton>
          <RButton variant="pri" disabled={!changed} loading={busy} onClick={() => submit()}>{t("save")}</RButton>
        </div>
      }>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <RLabel label={t("edit_value")}>{input}</RLabel>
        <RLabel small label={t("note")}>
          <RInput value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("edit_note_ph")} />
        </RLabel>
        <button type="submit" hidden />
      </form>

      <section className="flex flex-col gap-1" aria-labelledby="edit-history">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="edit-history" className="m-0 text-[15px] font-bold">{t("edit_history")}</h3>
          {c && (
            <RButton size="sm" variant="ghost" disabled={busy} onClick={() => onSave(asText(c.original), "")}>
              <RotateCcw aria-hidden /> {tf("restore_district", { v: show(c.original) })}
            </RButton>
          )}
        </div>
        <ol className="m-0 flex list-none flex-col p-0">
          {edits.map((e, i) => (
            <EditEntry key={e.id} e={e} first={i === 0} latest={i === 0} show={show} current={i === 0 && same(e.after, cur)}
              canGoBack={!same(e.before, cur)} busy={busy} onRevert={() => onRevert(e.id)} />
          ))}
          <li className={cn("flex gap-3 py-3", edits.length > 0 && "border-t border-r-sunk")}>
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-r-action" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
              {same(sentValue, null) ? <span>{officeName(row, lang)} · {t("sub_none")}</span> : <>
                <span>{tf("district_sent", { o: officeName(row, lang), v: show(sentValue) })}</span>
                <span className="text-r-muted">{row.submitted_at ? whenText(row.submitted_at, lang) : ""}{row.submitted_by ? ` · ${row.submitted_by}` : ""}</span>
              </>}
            </div>
            {!edits.length && <span className="self-center rounded-full bg-r-sunk px-2.5 py-0.5 text-xs font-bold text-r-muted">{t("current_value")}</span>}
          </li>
        </ol>
      </section>
    </RSheet>
  );
}

function EditEntry({ e, first, latest, show, current, canGoBack, busy, onRevert }: {
  e: ValueEdit; first: boolean; latest: boolean; show: (v: AnswerValue) => string; current: boolean; canGoBack: boolean; busy: boolean; onRevert: () => void;
}) {
  const { t, tf, lang } = useT();
  return (
    <li className={cn("flex gap-3 py-3", !first && "border-t border-r-sunk")}>
      <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", e.reverts || e.source === "office" ? "bg-r-field" : "bg-r-corrected")} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
        <span className="num"><span className="text-r-muted line-through">{show(e.before)}</span> → <b>{show(e.after)}</b>{e.reverts ? <span className="text-r-muted"> · {t("undone_tag")}</span> : null}</span>
        <span className="text-r-muted">{whenText(e.at, lang)} · {e.source === "office" ? t("src_office") : t("state_office")} · {e.by}</span>
        {e.note && <span className="rounded-lg bg-r-sunk px-2.5 py-1.5">{e.note}</span>}
      </div>
      <span className="flex shrink-0 flex-col items-end gap-1 self-center">
        {current && <span className="rounded-full bg-r-sunk px-2.5 py-0.5 text-xs font-bold text-r-muted">{t("current_value")}</span>}
        {canGoBack && (
          <RButton size="sm" variant="ghost" disabled={busy} onClick={onRevert}>
            <Undo2 aria-hidden /> {latest ? t("undo") : tf("go_back_to", { v: show(e.before) })}
          </RButton>
        )}
      </span>
    </li>
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
