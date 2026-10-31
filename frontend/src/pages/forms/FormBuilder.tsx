import * as React from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, CalendarDays, ChevronDown, ChevronRight, Eye, Lock, Pause, Play, Plus, Trash2 } from "lucide-react";
import { api, ApiError, type Column, type FieldType, type FormDef, type FormField, type Frequency } from "@/lib/api";
import { useMeta } from "@/lib/hooks";
import { useT, type TKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RButton, RCard, RCardTitle, RCheck, RError, RInput, RLabel, RPage, RSegmented, RSelect, RSheet, RTextarea, StatusMark } from "@/components/reports/kit";
import { DateInput } from "@/components/reports/DateInput";
import { dayMonth, fig, fullDay } from "@/components/reports/period";
import { Instructions } from "./MyForms";
import { fieldLabel, formTitle, useToday } from "./common";

const TYPES: FieldType[] = ["number", "text", "yesno", "choice", "date"];
/** Weekly is no longer offered for new forms; an existing weekly form keeps showing it. */
const FREQS: Frequency[] = ["daily", "once"];

type EditField = FormField & { uid: string; optionsText: string };
interface Draft {
  title_mr: string; title_en: string; instructions_mr: string; instructions_en: string; frequency: Frequency;
  start_date: string; end_date: string; deadline_hours: string; campaign_id: number | null;
  recipients: string[]; fields: EditField[];
}

let uidSeq = 0;
// Unique across reloads too, so fields restored from a local draft never collide with fresh ones.
const uid = () => `f${Date.now().toString(36)}_${++uidSeq}`;

function blankField(): EditField {
  return {
    uid: uid(), id: null, key: "", label_mr: "", label_en: "", help_mr: "", help_en: "", type: "number", required: false,
    options: [], optionsText: "", min_value: 0, max_value: null, integer: true, group: "", aggregate: "sum", archived: false, locked: false,
  };
}

/** A number field for one of the 12 report columns (the office data-entry sheet), keyed so imports and reports line up. */
function columnField(c: Column): EditField {
  return { ...blankField(), key: c.key, label_mr: c.label_mr, label_en: c.label_en, group: c.group === "other" ? "" : c.group };
}

function toDraft(f: FormDef | null, allOffices: string[], today: string, columns: Column[] = []): Draft {
  if (!f) {
    return {
      title_mr: "", title_en: "", instructions_mr: "", instructions_en: "", frequency: "daily", start_date: today, end_date: "",
      deadline_hours: "", campaign_id: null, recipients: allOffices,
      fields: columns.length ? columns.map(columnField) : [blankField()],
    };
  }
  return {
    title_mr: f.title_mr, title_en: f.title_en, instructions_mr: f.instructions_mr, instructions_en: f.instructions_en,
    frequency: f.frequency, start_date: f.start_date, end_date: f.end_date ?? "", deadline_hours: f.deadline_hours?.toString() ?? "",
    campaign_id: f.campaign_id, recipients: f.recipients,
    fields: (f.fields ?? []).map((x) => ({ ...x, uid: uid(), optionsText: x.options.join("\n") })),
  };
}

function toPayload(d: Draft) {
  return {
    title_mr: d.title_mr, title_en: d.title_en, instructions_mr: d.instructions_mr, instructions_en: d.instructions_en,
    frequency: d.frequency, start_date: d.start_date, end_date: d.frequency === "once" ? null : d.end_date || null,
    deadline_hours: d.deadline_hours === "" ? null : Number(d.deadline_hours), campaign_id: d.campaign_id,
    recipients: d.recipients,
    fields: d.fields.map((f) => ({
      id: f.id, key: f.key || null, label_mr: f.label_mr, label_en: f.label_en, help_mr: f.help_mr, help_en: f.help_en, type: f.type,
      required: f.required, options: f.optionsText.split("\n").map((o) => o.trim()).filter(Boolean),
      min_value: f.min_value, max_value: f.max_value, integer: f.integer, group: f.group, aggregate: f.type === "number" ? f.aggregate : "none",
      archived: f.archived,
    })),
  };
}

/** Every edit is kept in localStorage until it's saved, so a reload or crash never loses typing. */
const draftKey = (formId: number | null) => `form-draft:${formId ?? "new"}`;
function readLocal(formId: number | null): Draft | null {
  try { const raw = localStorage.getItem(draftKey(formId)); return raw ? JSON.parse(raw) as Draft : null; } catch { return null; }
}
function writeLocal(formId: number | null, d: Draft | null) {
  try { if (d) localStorage.setItem(draftKey(formId), JSON.stringify(d)); else localStorage.removeItem(draftKey(formId)); } catch { /* storage off */ }
}

/** Reuse the server draft's uids for saved fields so the "changed" highlight compares like with like. */
function restore(local: Draft, server: Draft): Draft {
  const byId = new Map(server.fields.filter((f) => f.id !== null).map((f) => [f.id, f.uid]));
  return { ...server, ...local, fields: local.fields.map((f) => ({ ...f, uid: (f.id !== null && byId.get(f.id)) || f.uid })) };
}

/** Human list of what changed since the last save, for the sticky bar. */
function changesOf(a: Draft, b: Draft | null, t: (k: TKey) => string, lang: string) {
  if (!b) return [];
  const out: string[] = [];
  const keys: [keyof Draft, TKey][] = [["title_mr", "title_mr"], ["title_en", "title_en"], ["instructions_mr", "instructions_mr"], ["instructions_en", "instructions_en"],
    ["frequency", "frequency"], ["start_date", "start_date"], ["end_date", "end_date"], ["deadline_hours", "deadline_hours"], ["campaign_id", "campaign_link"]];
  keys.forEach(([k, label]) => { if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(t(label)); });
  if (a.recipients.join() !== b.recipients.join()) out.push(t("recipients_word"));
  const before = new Map(b.fields.map((f) => [f.id ?? f.uid, JSON.stringify(toPayload({ ...b, fields: [f] }).fields[0])]));
  a.fields.forEach((f) => {
    const was = before.get(f.id ?? f.uid);
    const now = JSON.stringify(toPayload({ ...a, fields: [f] }).fields[0]);
    if (was !== now) out.push(fieldLabel(f, lang) || t("add_field"));
  });
  if (a.fields.map((f) => f.id ?? f.uid).join() !== b.fields.map((f) => f.id ?? f.uid).join() && !out.length) out.push(t("field_order"));
  return out;
}

export default function FormBuilderPage() {
  const { id } = useParams();
  const formId = id ? Number(id) : null;
  const { t, tf, lang } = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: meta } = useMeta();
  const today = useToday();
  const allOffices = React.useMemo(() => meta?.divisions.flatMap((d) => d.offices.map((o) => o.code)) ?? [], [meta]);
  const { data: form, error } = useQuery({ queryKey: ["form", formId], enabled: !!formId, queryFn: () => api.get<FormDef>(`/api/forms/${formId}`) });
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [saved, setSaved] = React.useState<Draft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (draft || !meta || !today || (formId && !form)) return;
    const d = toDraft(form ?? null, allOffices, today, meta.columns);
    const local = readLocal(formId);
    const back = local && JSON.stringify(toPayload(local)) !== JSON.stringify(toPayload(d)) ? restore(local, d) : null;
    setDraft(back ?? d);
    setSaved(d);
    if (back) toast.info(t("draft_restored"), { action: { label: t("discard"), onClick: () => { writeLocal(formId, null); setDraft(d); } } });
  }, [form, meta, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!draft && !!saved && JSON.stringify(toPayload(draft)) !== JSON.stringify(toPayload(saved));
  React.useEffect(() => {
    if (draft) writeLocal(formId, dirty ? draft : null);
  }, [draft, dirty, formId]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  React.useEffect(() => {
    if (blocker.state === "blocked") {
      if (confirm(t("unsaved_leave"))) { writeLocal(formId, null); blocker.proceed(); } else blocker.reset();
    }
  }, [blocker, t, formId]);

  if (error) return <RPage><RError error={error} /></RPage>;
  if (!draft) return <RPage><div className="h-96 animate-pulse rounded-2xl bg-r-sunk" /></RPage>;
  const up = (patch: Partial<Draft>) => setDraft((d) => d && { ...d, ...patch });
  const upField = (u: string, patch: Partial<EditField>) => setDraft((d) => d && { ...d, fields: d.fields.map((f) => f.uid === u ? { ...f, ...patch } : f) });
  const move = (u: string, by: number) => setDraft((d) => {
    if (!d) return d;
    const fs = [...d.fields];
    const i = fs.findIndex((f) => f.uid === u);
    const [x] = fs.splice(i, 1);
    fs.splice(Math.max(0, Math.min(fs.length, i + by)), 0, x);
    return { ...d, fields: fs };
  });

  const apply = (savedForm: FormDef) => {
    const d = toDraft(savedForm, allOffices, today);
    writeLocal(formId, null);
    setDraft(d);
    setSaved(d);
    qc.setQueryData(["form", savedForm.id], savedForm);
    qc.invalidateQueries({ queryKey: ["forms"] });
    qc.invalidateQueries({ queryKey: ["forms-mine"] });
  };
  const save = async (publish = false) => {
    setSaving(true);
    try {
      const body = toPayload(draft);
      let s = formId ? await api.put<FormDef>(`/api/forms/${formId}`, body) : await api.post<FormDef>("/api/forms", body);
      if (publish) s = await api.post<FormDef>(`/api/forms/${s.id}/publish`);
      apply(s);
      toast.success(publish ? t("status_published") : t("saved"));
      if (!formId) { writeLocal(null, null); nav(`/forms/${s.id}/edit`, { replace: true }); }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const lifecycle = async (action: "publish" | "pause" | "restore" | "unpublish") => {
    if (!formId) return;
    if ((action === "pause" || action === "unpublish") && !confirm(t(`confirm_${action}`))) return;
    try { apply(await api.post<FormDef>(`/api/forms/${formId}/${action}`)); toast.success(t("saved")); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : String(e)); }
  };
  const remove = async () => {
    if (!formId || !confirm(t("delete_confirm"))) return;
    try { await api.del(`/api/forms/${formId}`); toast.success(t("deleted")); nav("/forms"); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : String(e)); }
  };

  const status = form?.status ?? "draft";
  const scheduleLocked = !!form?.schedule_locked;
  const title = formTitle({ title_mr: draft.title_mr, title_en: draft.title_en }, lang) || t("new_form");
  const active = draft.fields.filter((f) => !f.archived);
  const archivedF = draft.fields.filter((f) => f.archived);
  const changes = dirty ? changesOf(draft, saved, t, lang) : [];
  const allChosen = draft.recipients.length === allOffices.length;
  const freqs = FREQS.includes(draft.frequency) ? FREQS : [...FREQS, draft.frequency];
  const needEnd = draft.frequency === "daily" && !draft.end_date;
  const spanDays = draft.start_date && draft.end_date >= draft.start_date
    ? Math.round((Date.parse(draft.end_date) - Date.parse(draft.start_date)) / 86_400_000) + 1 : 0;
  const dateProblem = !draft.start_date ? t(draft.frequency === "once" ? "need_day" : "need_dates") : needEnd ? t("need_dates") : null;

  return (
    <RPage className="pb-0">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2.5">
          <Link to="/forms" className="text-[13px] font-bold text-r-muted no-underline hover:text-r-ink">{t("nav_forms")} ›</Link>
          <h1 className="disp m-0 text-[32px] leading-[1.1] font-bold">{title}</h1>
          {status === "published" && (
            <span className="flex items-center gap-1.5 self-start rounded-full bg-r-accepted-soft px-2.5 py-[3px] text-sm font-bold text-r-accepted">
              <span className="size-2 rounded-full bg-r-accepted" aria-hidden />{t("status_published")}
            </span>
          )}
          {status === "paused" && (
            <span className="flex items-center gap-1.5 self-start rounded-full bg-r-returned-soft px-2.5 py-[3px] text-sm font-bold text-r-returned-ink">
              <span className="size-2 rounded-full bg-r-returned" aria-hidden />{t("status_paused")}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {status === "published" && <RButton size="sm" title={t("pause_hint")} onClick={() => lifecycle("pause")}><Pause aria-hidden /> {t("pause")}</RButton>}
          {status === "paused" && <RButton size="sm" variant="pri" onClick={() => lifecycle("publish")}><Play aria-hidden /> {t("resume")}</RButton>}
          {status === "archived" && <RButton size="sm" onClick={() => lifecycle("restore")}>{t("restore")}</RButton>}
          {!!formId && status !== "archived" && <RButton size="sm" variant="danger" onClick={remove}><Trash2 aria-hidden /> {t("delete")}</RButton>}
        </div>
      </div>

      {scheduleLocked && (
        <div className="flex items-start gap-3 rounded-xl bg-r-sunk px-4 py-3.5">
          <Lock className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div><b>{t("locked_title")}</b> {t("schedule_locked")}</div>
        </div>
      )}

      <div className="flex w-full max-w-[960px] flex-col gap-5">
          <RCard>
            <RLabel small label={t("title_mr")}><RInput value={draft.title_mr} onChange={(e) => up({ title_mr: e.target.value })} className="min-h-[46px] text-[17px] font-bold" /></RLabel>
            <RLabel small label={t("title_en")}><RInput value={draft.title_en} onChange={(e) => up({ title_en: e.target.value })} className="min-h-[46px] text-[17px] font-bold" /></RLabel>
            <RLabel small label={t("instructions_mr")}><RTextarea rows={4} value={draft.instructions_mr} onChange={(e) => up({ instructions_mr: e.target.value })} /></RLabel>
            <RLabel small label={t("instructions_en")}><RTextarea rows={3} value={draft.instructions_en} onChange={(e) => up({ instructions_en: e.target.value })} /></RLabel>
          </RCard>

          <RCard>
            <RCardTitle>{t("tab_schedule")}</RCardTitle>
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-bold text-r-muted">{t("frequency")}</span>
              {scheduleLocked ? <LockedChip>{t(`freq_${draft.frequency}` as TKey)}</LockedChip> : (
                <RSegmented label={t("frequency")} value={draft.frequency} className="self-start"
                  onChange={(frequency) => up({ frequency, end_date: frequency === "once" ? "" : draft.end_date })}
                  options={freqs.map((x) => ({ value: x, label: t(`freq_${x}` as TKey) }))} />
              )}
            </div>
            {draft.frequency === "once" ? (
              <RLabel small label={t("report_day")} hint={t("once_hint")}>
                {scheduleLocked ? <LockedChip>{dayMonth(draft.start_date, lang)}</LockedChip> : (
                  <DateInput required value={draft.start_date} aria-invalid={!draft.start_date} onChange={(d) => up({ start_date: d })} />
                )}
              </RLabel>
            ) : (
              <div className="flex flex-wrap gap-4">
                <RLabel small label={t("start_date")}>
                  {scheduleLocked ? <LockedChip>{dayMonth(draft.start_date, lang)}</LockedChip> : (
                    <DateInput required value={draft.start_date} aria-invalid={!draft.start_date} onChange={(d) => up({ start_date: d })} />
                  )}
                </RLabel>
                <RLabel small label={t("end_date")}>
                  <DateInput required={draft.frequency === "daily"} value={draft.end_date} min={draft.start_date} aria-invalid={needEnd}
                    onChange={(d) => up({ end_date: d })} />
                </RLabel>
              </div>
            )}
            {dateProblem ? <span className="text-sm font-bold text-r-overdue-ink">{dateProblem}</span> : draft.frequency === "daily" && spanDays > 0 && (
              <div className="flex items-start gap-3 rounded-xl bg-r-ground px-3.5 py-3">
                <CalendarDays className="mt-0.5 size-5 shrink-0 text-r-action" aria-hidden />
                <div className="flex flex-col gap-0.5">
                  <span>{tf("daily_span", { a: fullDay(draft.start_date, lang), b: fullDay(draft.end_date, lang) })}</span>
                  <span className="num text-sm font-bold text-r-muted">{tf("n_days", { n: fig(spanDays) })}</span>
                </div>
              </div>
            )}
          </RCard>

          <RCard>
            <RCardTitle>{t("who_fills")}</RCardTitle>
            <div role="radiogroup" aria-label={t("who_fills")} className="flex flex-col gap-2">
              <RCheck radio checked={allChosen} onChange={() => up({ recipients: allOffices })} className="items-start rounded-[10px] p-3 font-normal [&>span:first-child]:mt-0.5">
                <span><b>{t("all_offices")}</b><br /><span className="text-sm text-r-muted">{tf("n_offices_in_div", { o: allOffices.length, d: meta?.divisions.length ?? 0 })}</span></span>
              </RCheck>
              <RCheck radio checked={!allChosen} onChange={() => allChosen && up({ recipients: [] })} className="items-start rounded-[10px] p-3 font-normal [&>span:first-child]:mt-0.5">
                <span><b>{t("chosen_offices")}</b><br /><span className="text-sm text-r-muted">{allChosen ? t("pick_official_list") : tf("n_selected_of", { a: draft.recipients.length, b: allOffices.length })}</span></span>
              </RCheck>
            </div>
            {!allChosen && <Recipients value={draft.recipients} onChange={(recipients) => up({ recipients })} />}
          </RCard>

          <RCard className="gap-1.5">
            <div className="flex items-center justify-between gap-3 pb-2">
              <RCardTitle>{t("tab_fields")} <span className="num font-medium text-r-muted">{active.length}</span></RCardTitle>
              <RButton size="sm" onClick={() => { const f = blankField(); up({ fields: [...draft.fields, f] }); setOpen(f.uid); }}><Plus aria-hidden /> {t("add_field")}</RButton>
            </div>
            <div className="overflow-x-auto scrollbar-thin">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-[52px_28px_minmax(180px,1fr)_120px_88px_76px_76px_40px] items-center gap-2.5 pb-2 text-[13px] font-bold text-r-muted">
                  <span /><span>#</span><span>{t("field_label_mr")}</span><span>{t("field_type")}</span><span>{t("required")}</span><span>{t("min")}</span><span>{t("max")}</span><span />
                </div>
                {active.map((f, i) => (
                  <FieldRow key={f.uid} f={f} n={i + 1} first={i === 0} last={i === active.length - 1} open={open === f.uid} changed={!saved?.fields.some((s) => s.uid === f.uid && JSON.stringify(s) === JSON.stringify(f))}
                    onToggle={() => setOpen(open === f.uid ? null : f.uid)} onChange={(p) => upField(f.uid, p)} onMove={(by) => move(f.uid, by)}
                    onRemove={() => f.locked ? upField(f.uid, { archived: true }) : setDraft((d) => d && { ...d, fields: d.fields.filter((x) => x.uid !== f.uid) })} />
                ))}
              </div>
            </div>
            {archivedF.length > 0 && (
              <details className="mt-2.5 rounded-[10px] bg-r-ground px-3.5 py-3">
                <summary className="cursor-pointer font-bold">{t("archived")} · {archivedF.length}</summary>
                {archivedF.map((f) => (
                  <div key={f.uid} className="flex flex-wrap items-center justify-between gap-2 pt-2.5 text-sm">
                    <span><b>{fieldLabel(f, lang)}</b> · {t("archived_note")}</span>
                    <RButton size="sm" onClick={() => upField(f.uid, { archived: false })}>{t("restore")}</RButton>
                  </div>
                ))}
              </details>
            )}
          </RCard>
          {form && <p className="m-0 px-1 text-[13px] text-r-muted">{form.slug} · {t("created_by")} {form.created_by}</p>}
      </div>

      <footer className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-t border-r-line bg-r-card px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <RButton variant={status === "draft" ? "default" : "pri"} loading={saving} disabled={(!dirty && !!formId) || (status !== "draft" && !!dateProblem)} title={status !== "draft" ? dateProblem ?? undefined : undefined} onClick={() => save(false)}>{t("save_changes")}</RButton>
        {status === "draft" && <RButton variant="pri" loading={saving} disabled={!!dateProblem} title={dateProblem ?? undefined} onClick={() => save(true)}>{t("publish")}</RButton>}
        {dirty && formId && <RButton variant="ghost" onClick={() => saved && setDraft(saved)}>{t("discard")}</RButton>}
        <span className="min-w-0 flex-1 truncate text-sm">
          {dirty ? <><b>{tf("n_unsaved_changes", { n: changes.length || 1 })}:</b> {changes.slice(0, 4).join(", ")}{changes.length > 4 && "…"} <span className="text-r-muted">· {t("autosaved_local")}</span></> : formId ? <span className="text-r-muted">{t("all_saved")}</span> : null}
        </span>
        <RButton onClick={() => setPreview(true)}><Eye aria-hidden /> {t("preview_as_office")}</RButton>
      </footer>

      {preview && <PreviewSheet draft={draft} onClose={() => setPreview(false)} />}
    </RPage>
  );
}

function LockedChip({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  return (
    <span title={t("locked_tip")} className="inline-flex items-center gap-1.5 justify-self-end rounded-md bg-r-sunk px-2 py-1 text-[13px] font-bold whitespace-nowrap text-r-muted">
      <Lock className="size-3" aria-hidden /> {children}
    </span>
  );
}

// --------------------------------------------------------------------------- one field row
function FieldRow({ f, n, first, last, open, changed, onToggle, onChange, onMove, onRemove }: {
  f: EditField; n: number; first: boolean; last: boolean; open: boolean; changed: boolean;
  onToggle: () => void; onChange: (p: Partial<EditField>) => void; onMove: (by: number) => void; onRemove: () => void;
}) {
  const { t } = useT();
  const num = (v: string) => (v === "" ? null : Number(v.replace(/[^\d.-]/g, "")));
  return (
    <div className={cn("border-t border-r-sunk", changed && "rounded-lg bg-r-today")}>
      <div className="grid grid-cols-[52px_28px_minmax(180px,1fr)_120px_88px_76px_76px_40px] items-center gap-2.5 py-2">
        <span className="flex">
          <button type="button" aria-label={t("move_up")} disabled={first} onClick={() => onMove(-1)} className="flex size-[26px] cursor-pointer items-center justify-center rounded border-0 bg-transparent text-r-muted hover:bg-r-sunk disabled:opacity-30"><ArrowUp className="size-4" /></button>
          <button type="button" aria-label={t("move_down")} disabled={last} onClick={() => onMove(1)} className="flex size-[26px] cursor-pointer items-center justify-center rounded border-0 bg-transparent text-r-muted hover:bg-r-sunk disabled:opacity-30"><ArrowDown className="size-4" /></button>
        </span>
        <span className="num text-[13px] text-r-muted">{n}</span>
        <RInput value={f.label_mr} aria-label={t("field_label_mr")} onChange={(e) => onChange({ label_mr: e.target.value })} />
        {f.locked ? <LockedChip>{t(`type_${f.type}` as TKey)}</LockedChip> : (
          <RSelect value={f.type} aria-label={t("field_type")} onChange={(e) => { const type = e.target.value as FieldType; onChange({ type, aggregate: type === "number" ? "sum" : "none" }); }}>
            {TYPES.map((x) => <option key={x} value={x}>{t(`type_${x}` as TKey)}</option>)}
          </RSelect>
        )}
        <RCheck plain checked={f.required} aria-label={t("required")} onChange={(required) => onChange({ required })}>{f.required ? t("yes") : t("no")}</RCheck>
        {f.type === "number" ? (
          <>
            <RInput className="num text-right" aria-label={t("min")} placeholder="—" value={f.min_value ?? ""} onChange={(e) => onChange({ min_value: num(e.target.value) })} />
            <RInput className="num text-right" aria-label={t("max")} placeholder="—" value={f.max_value ?? ""} onChange={(e) => onChange({ max_value: num(e.target.value) })} />
          </>
        ) : <><span className="text-center text-r-faint">—</span><span className="text-center text-r-faint">—</span></>}
        <button type="button" aria-expanded={open} aria-label={t("more_for_field")} onClick={onToggle}
          className="flex size-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-r-ink hover:bg-r-sunk">
          {open ? <ChevronDown className="size-[18px]" /> : <ChevronRight className="size-[18px]" />}
        </button>
      </div>
      {open && (
        <div className="mb-2 ml-[90px] grid gap-3 rounded-[10px] bg-r-ground p-3 sm:grid-cols-2">
          <RLabel small label={t("field_label_en")}><RInput value={f.label_en} onChange={(e) => onChange({ label_en: e.target.value })} /></RLabel>
          <RLabel small label={t("group")}><RInput value={f.group} placeholder="print / video / social" onChange={(e) => onChange({ group: e.target.value })} /></RLabel>
          <RLabel small label={`${t("help_text")} (मराठी)`}><RInput value={f.help_mr} onChange={(e) => onChange({ help_mr: e.target.value })} /></RLabel>
          <RLabel small label={`${t("help_text")} (English)`}><RInput value={f.help_en} onChange={(e) => onChange({ help_en: e.target.value })} /></RLabel>
          {f.type === "number" && (
            <div className="flex flex-wrap gap-4 sm:col-span-2">
              <RCheck checked={f.integer} onChange={(integer) => onChange({ integer })}>{t("whole_numbers")}</RCheck>
              <RCheck checked={f.aggregate === "sum"} onChange={(on) => onChange({ aggregate: on ? "sum" : "none" })}>{t("sum_in_reports")}</RCheck>
            </div>
          )}
          {f.type === "choice" && (
            <RLabel small label={t("options")} className="sm:col-span-2"><RTextarea rows={3} value={f.optionsText} onChange={(e) => onChange({ optionsText: e.target.value })} /></RLabel>
          )}
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            {f.key && <code className="num text-xs text-r-muted">{f.key}</code>}
            <RButton size="sm" variant="danger" className="ml-auto" onClick={onRemove}>
              <Trash2 aria-hidden /> {f.locked ? t("archive") : t("remove")}
            </RButton>
          </div>
          {f.locked && <span className="text-xs text-r-muted sm:col-span-2">{t("archive_explain")}</span>}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- recipients
function Recipients({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { t, name } = useT();
  const { data: meta } = useMeta();
  const set = new Set(value);
  const all = meta?.divisions.flatMap((d) => d.offices.map((o) => o.code)) ?? [];
  const toggle = (codes: string[], on: boolean) => {
    const next = new Set(value);
    codes.forEach((c) => (on ? next.add(c) : next.delete(c)));
    onChange(all.filter((c) => next.has(c)));
  };
  return (
    <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1 scrollbar-thin">
      <div className="flex gap-2">
        <RButton size="sm" onClick={() => toggle(all, true)}>{t("select_all")}</RButton>
        <RButton size="sm" variant="ghost" onClick={() => toggle(all, false)}>{t("select_none")}</RButton>
      </div>
      {meta?.divisions.map((d) => {
        const codes = d.offices.map((o) => o.code);
        const n = codes.filter((c) => set.has(c)).length;
        return (
          <details key={d.code} className="rounded-[10px] border border-r-line px-3 py-2" open={n > 0 && n < codes.length}>
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold">
              {/* preventDefault keeps a tick from also opening/closing the <details> */}
              <span className="flex" onClick={(e) => e.preventDefault()}>
                <RCheck plain checked={n === codes.length} mixed={n > 0 && n < codes.length} aria-label={d.label_mr} onChange={(on) => toggle(codes, on)} />
              </span>
              {d.label_mr} <span className="num ml-auto font-normal text-r-muted">{n}/{codes.length}</span>
            </summary>
            <div className="flex flex-col gap-1 pt-2 pl-7">
              {d.offices.map((o) => (
                <RCheck key={o.code} plain checked={set.has(o.code)} onChange={(on) => toggle([o.code], on)}>{name(o)}</RCheck>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

// --------------------------------------------------------------------------- preview as an office
function PreviewSheet({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const { t, lang } = useT();
  const fields = draft.fields.filter((f) => !f.archived);
  return (
    <RSheet open onClose={onClose} closeLabel={t("discard")} title={formTitle(draft, lang) || "—"} description={`${t("preview")} · ${t(`freq_${draft.frequency}` as TKey)}`}>
      {(draft.instructions_mr || draft.instructions_en) && (
        <details className="rounded-xl bg-r-card px-3.5 py-3" open>
          <summary className="cursor-pointer font-bold">{t("instructions_from")}</summary>
          <Instructions text={lang === "en" && draft.instructions_en ? draft.instructions_en : draft.instructions_mr} className="mt-2" />
        </details>
      )}
      <div className="flex flex-col rounded-[14px] bg-r-card">
        {fields.map((f, i) => (
          <div key={f.uid} className={cn("flex items-center justify-between gap-3 px-3.5 py-3", i > 0 && "border-t border-r-sunk")}>
            <span className="flex flex-col">
              <span className="font-bold">{fieldLabel(f, lang) || "…"}{f.required && <span className="text-r-overdue"> *</span>}</span>
              <span className="text-[13px] text-r-muted">{[f.required ? t("required") : "", f.type === "number" && f.max_value !== null ? `${f.min_value ?? 0}–${f.max_value}` : "", lang === "en" ? f.help_en || f.help_mr : f.help_mr].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="flex h-[54px] w-28 shrink-0 items-center justify-end rounded-xl border-[1.5px] border-dashed border-r-faint bg-r-ground px-3.5 text-sm text-r-faint">
              {f.type === "number" ? t("not_entered") : t(`type_${f.type}` as TKey)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-sm text-r-muted"><StatusMark mark="pend" /> {t("preview_note")}</div>
    </RSheet>
  );
}
