import * as React from "react";
import { Link, useBlocker, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Check, ChevronLeft, ClipboardPaste, History, Info, Lock } from "lucide-react";
import { api, ApiError, type AnswerValue, type FormDef, type FormField, type PeriodsResponse, type Submission } from "@/lib/api";
import { useMeta } from "@/lib/hooks";
import { useUser } from "@/lib/auth";
import { useT, type TKey } from "@/lib/i18n";
import { addDays, cn } from "@/lib/utils";
import { RAlert, RButton, RCheck, RError, RLabel, RPage, RSelect, RSheet, RTextarea, StatusMark, markOf, type Mark } from "@/components/reports/kit";
import { DateInput } from "@/components/reports/DateInput";
import { dayMonth, isOverdue, longDay, periodOf, rangeText, shortDay, whenText } from "@/components/reports/period";
import { Instructions } from "./MyForms";
import { fieldLabel, formTitle, useToday } from "./common";

// Keys shown together are pressed together (Ctrl + V); each row is a separate shortcut.
const SHORTCUTS: [string[], TKey][] = [
  [["Tab"], "kb_next"], [["Enter"], "kb_down"], [["← ↑ → ↓"], "kb_arrows"],
  [["Ctrl", "V"], "kb_paste"], [["Delete"], "kb_clear"], [["Ctrl", "S"], "kb_save"],
];

type Draft = Record<string, Record<string, string>>; // period_start -> field key -> text ("" = blank)
type Tr = ReturnType<typeof useT>;

function toText(v: AnswerValue | undefined) { return v === null || v === undefined ? "" : String(v); }
const ck = (ps: string, k: string) => `${ps}|${k}`;

export function useIsDesktop() {
  const q = "(min-width: 1024px)";
  const [m, setM] = React.useState(() => window.matchMedia(q).matches);
  React.useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}

/** Why a typed value can't be saved, or "" when it's fine. */
function problemOf(f: FormField, v: string, tr: Tr) {
  if (v === "" || f.type !== "number") return "";
  if (!/^\d+(\.\d+)?$/.test(v)) return tr.t("digits_only");
  if (f.integer && !/^\d+$/.test(v)) return tr.t("whole_only");
  const n = Number(v);
  if (f.min_value !== null && n < f.min_value) return tr.tf("below_min", { min: f.min_value });
  if (f.max_value !== null && n > f.max_value) return tr.tf("above_max", { max: f.max_value });
  return "";
}

function hintOf(f: FormField, tr: Tr) {
  const help = tr.lang === "en" ? f.help_en || f.help_mr : f.help_mr;
  const parts = [f.required ? tr.t("required") : "", f.type === "number" && f.max_value !== null ? tr.tf("range_hint", { min: f.min_value ?? 0, max: f.max_value }) : "", help];
  return parts.filter(Boolean).join(" · ");
}

function showValue(f: FormField, v: string, t: Tr["t"]) {
  if (v === "") return "—";
  if (f.type === "yesno") return v === "yes" ? t("yes") : t("no");
  return v;
}

export default function FillFormPage() {
  const { id } = useParams();
  const formId = Number(id);
  const me = useUser();
  const tr = useT();
  const { t, tf, name, lang } = tr;
  const { data: meta } = useMeta();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const today = useToday();
  const isDesktop = useIsDesktop();
  const view = isDesktop ? "sheet" : "day";

  const officesAll = meta?.divisions.flatMap((d) => d.offices) ?? [];
  const office = params.get("office") || (me.role === "district" ? me.office?.code ?? "" : "");
  const requested = params.get("period") || today;

  const { data: formDef, error: formError } = useQuery({ queryKey: ["form", formId], enabled: !!formId, queryFn: () => api.get<FormDef>(`/api/forms/${formId}`) });
  const lastDay = formDef?.end_date && formDef.end_date < today ? formDef.end_date : today;
  // every period of the form so far, all on one page
  const startPs = formDef?.start_date ?? "";
  const endPs = formDef ? periodOf(formDef, lastDay) : "";
  const { data, isLoading, error: periodsError } = useQuery({
    queryKey: ["form-periods", formId, office, startPs, endPs],
    enabled: !!formDef && !!office,
    queryFn: () => api.get<PeriodsResponse>(`/api/forms/${formId}/periods?office=${office}&start=${startPs}&end=${endPs}`),
    placeholderData: (p) => p,
  });
  const error = formError ?? periodsError;
  const form = data?.form ?? formDef;
  const fields = React.useMemo(() => (form?.fields ?? []).filter((f) => !f.archived), [form]);
  const periods = React.useMemo(() => data?.periods ?? [], [data]);
  const selected = periods.find((p) => p.period_start === (form ? periodOf(form, requested) : "")) ?? periods[periods.length - 1];

  const original = React.useMemo(() => {
    const o: Draft = {};
    periods.forEach((p) => { o[p.period_start] = Object.fromEntries(fields.map((f) => [f.key, toText(p.values[f.key])])); });
    return o;
  }, [periods, fields]);
  const [draft, setDraft] = React.useState<Draft>({});
  /** New zeros the office has said are real (saved zeros are confirmed already). */
  const [confirmed, setConfirmed] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [reviewing, setReviewing] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<string[] | null>(null);
  React.useEffect(() => { setDraft(original); setConfirmed(new Set()); }, [original]);

  const cur = React.useCallback((ps: string, k: string) => draft[ps]?.[k] ?? original[ps]?.[k] ?? "", [draft, original]);
  const dirtyOf = (ps: string) => fields.some((f) => cur(ps, f.key) !== (original[ps]?.[f.key] ?? ""));
  const dirtyPeriods = periods.filter((p) => dirtyOf(p.period_start)).map((p) => p.period_start);
  const dirty = dirtyPeriods.length > 0;

  const isZero = (f: FormField, v: string) => f.type === "number" && v !== "" && /^\d+(\.\d+)?$/.test(v) && Number(v) === 0;
  const zeroState = (ps: string, f: FormField): "none" | "ask" | "ok" => {
    const v = cur(ps, f.key);
    if (!isZero(f, v)) return "none";
    return original[ps]?.[f.key] === v || confirmed.has(ck(ps, f.key)) ? "ok" : "ask";
  };
  const check = (ps: string) => {
    const bad = fields.filter((f) => problemOf(f, cur(ps, f.key), tr));
    const ask = fields.filter((f) => zeroState(ps, f) === "ask");
    const missing = fields.filter((f) => f.required && cur(ps, f.key) === "");
    const filled = fields.filter((f) => cur(ps, f.key) !== "").length;
    return { bad, ask, missing, filled };
  };

  // unsaved-changes guard: in-app navigation and tab close
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  React.useEffect(() => {
    if (blocker.state === "blocked") { if (confirm(t("unsaved_leave"))) blocker.proceed(); else blocker.reset(); }
  }, [blocker, t]);
  React.useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  const go = (patch: Record<string, string>, keepDraft = false) => {
    if (dirty && !keepDraft && !confirm(t("unsaved_leave"))) return;
    setParams((prev) => { const n = new URLSearchParams(prev); Object.entries(patch).forEach(([k, v]) => n.set(k, v)); return n; }, { replace: true });
  };

  const setCell = (ps: string, k: string, v: string) => {
    const f = fields.find((x) => x.key === k);
    const clean = f?.type === "number" ? v.replace(/[^\d.]/g, "") : v;
    setDraft((prev) => ({ ...prev, [ps]: { ...(prev[ps] ?? original[ps]), [k]: clean } }));
    setConfirmed((prev) => { if (!prev.has(ck(ps, k))) return prev; const n = new Set(prev); n.delete(ck(ps, k)); return n; });
  };
  const confirmZeros = (ps: string, keys: string[], on = true) => setConfirmed((prev) => {
    const n = new Set(prev);
    keys.forEach((k) => (on ? n.add(ck(ps, k)) : n.delete(ck(ps, k))));
    return n;
  });

  const payload = (ps: string) => Object.fromEntries(fields.map((f) => {
    const v = cur(ps, f.key);
    return [f.key, v === "" ? null : f.type === "number" ? Number(v) : v];
  }));
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["form-periods"] });
    qc.invalidateQueries({ queryKey: ["forms-mine"] });
  };
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await refresh(); return true; }
    catch (e) { toast.error(e instanceof ApiError ? e.message : String(e)); qc.invalidateQueries({ queryKey: ["form-periods"] }); return false; }
    finally { setBusy(false); }
  };
  /** Periods whose edits can be saved now: no bad figure, no zero waiting for a yes. */
  const savable = dirtyPeriods.filter((ps) => { const c = check(ps); return !c.bad.length && !c.ask.length; });
  const blockedDirty = dirtyPeriods.length - savable.length;
  const saveDrafts = () => run(async () => {
    for (const ps of savable) await api.put(`/api/forms/${formId}/submissions/${office}/${ps}`, { values: payload(ps), confirm_zero: true });
  }, t("saved"));
  const send = async (list: string[], note = "") => {
    const ok = await run(async () => {
      for (const ps of list) {
        await api.put(`/api/forms/${formId}/submissions/${office}/${ps}`, { values: payload(ps), confirm_zero: true, note: note || null, submit: true });
      }
      // other edited periods are kept as drafts alongside
      for (const ps of savable.filter((x) => !list.includes(x))) {
        await api.put(`/api/forms/${formId}/submissions/${office}/${ps}`, { values: payload(ps), confirm_zero: true });
      }
    }, t("sub_submitted"));
    if (ok) { setReviewing(null); setSent(list); }
  };

  // offices this user can open: district = own; zone = its division's recipients; state = every recipient
  const recipients = form?.recipients ?? [];
  const choices = me.role === "district" ? (me.office ? [me.office.code] : []) : officesAll.map((o) => o.code).filter((c) => recipients.includes(c));
  React.useEffect(() => {
    if (!office && choices.length) setParams((p) => { const n = new URLSearchParams(p); n.set("office", choices[0]); return n; }, { replace: true });
  }, [office, choices.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const officeRef = officesAll.find((o) => o.code === office);
  const back = me.role === "state" ? "/forms" : me.role === "zone" ? "/office/board" : "/forms/mine";
  const instructions = form ? (lang === "en" && form.instructions_en ? form.instructions_en : form.instructions_mr) : "";

  // Ctrl/Cmd+S saves drafts
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (savable.length && !busy) void saveDrafts(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const officePicker = choices.length > 1 && (
    <RLabel small label={t("office")}>
      <RSelect value={office} onChange={(e) => go({ office: e.target.value })} className="w-full sm:w-auto sm:min-w-56">
        {meta?.divisions.map((dv) => {
          const opts = dv.offices.filter((o) => choices.includes(o.code));
          return opts.length ? <optgroup key={dv.code} label={dv.label_mr}>{opts.map((o) => <option key={o.code} value={o.code}>{name(o)}</option>)}</optgroup> : null;
        })}
      </RSelect>
    </RLabel>
  );
  const sheetMode = view === "sheet" && form?.frequency !== "once";
  // keep the chosen day visible in the phone strip (scrolls the strip only, never the page)
  const stripRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>("[aria-selected=true]");
    if (strip && tab) strip.scrollLeft = tab.offsetLeft - strip.offsetLeft - (strip.clientWidth - tab.clientWidth) / 2;
  }, [selected?.period_start, periods.length]);
  const reviewP = periods.find((p) => p.period_start === reviewing);

  return (
    <RPage className={cn("gap-4", !sheetMode && "mx-auto w-full max-w-[720px]")}>
      {/* ---------------------------------------------------------------- header */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 items-start gap-1">
            <Link to={back} aria-label={t("back")} className="-ml-2.5 flex size-11 shrink-0 items-center justify-center rounded-lg text-r-ink hover:bg-r-sunk">
              <ChevronLeft className="size-6" aria-hidden />
            </Link>
            <div className="flex min-w-0 flex-col">
              <h1 className={cn("m-0 leading-[1.15] font-bold", sheetMode ? "disp text-[32px]" : "text-[19px]")}>{form ? formTitle(form, lang) : "…"}</h1>
              <span className="text-sm text-r-muted">
                {name(officeRef)}
                {form && sheetMode && <> · {t(`freq_${form.frequency}` as TKey)}, {rangeText(form.start_date, form.end_date ?? lastDay, lang)}{form.deadline_hours !== null && <> · {tf("each_due", { h: form.deadline_hours })}</>}</>}
              </span>
            </div>
          </div>
          {officePicker && <div className="flex flex-wrap items-end gap-3">{officePicker}</div>}
        </div>

        {!sheetMode && form && form.frequency !== "once" && periods.length > 0 && (
          <div className="flex items-stretch gap-1.5">
            <div ref={stripRef} role="tablist" aria-label={t("period")} className="flex flex-1 gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
              {periods.map((p) => {
                const on = p.period_start === selected?.period_start;
                return (
                  <button key={p.period_start} role="tab" type="button" aria-selected={on}
                    onClick={() => !on && go({ period: p.period_start }, true)}
                    className={cn("flex min-h-[76px] w-[60px] flex-none cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl text-r-ink",
                      on ? "border-2 border-r-ink bg-r-ground" : "border-[1.5px] border-r-line bg-r-card")}>
                    <span className="text-xs font-bold">{new Date(p.period_start + "T00:00:00").toLocaleDateString(lang === "mr" ? "mr-IN" : "en-IN", { weekday: "short" })}</span>
                    <span className="num text-lg font-semibold">{new Date(p.period_start + "T00:00:00").getDate()}</span>
                    <StatusMark mark={dirtyOf(p.period_start) ? "draft" : markOf(p.status, isOverdue(p.status, p.deadline))} late={p.late} />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {me.role === "zone" && <RAlert tone="info">{t("read_only")}</RAlert>}

      {error ? <RError error={error} /> : isLoading || !data || !form ? (
        <div className="flex flex-col gap-3" aria-busy>{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-r-sunk" />)}</div>
      ) : !periods.length ? (
        <RAlert tone="info">{t("rows_none")}</RAlert>
      ) : sheetMode ? (
        <SheetView form={form} periods={periods} fields={fields} cur={cur} setCell={setCell} original={original}
          zeroState={zeroState} check={check} confirmZeros={confirmZeros} dirtyOf={dirtyOf} busy={busy}
          instructions={instructions} onSave={saveDrafts} savable={savable.length} blockedDirty={blockedDirty} dirtyCount={dirtyPeriods.length}
          onDiscard={() => { setDraft(original); setConfirmed(new Set()); }} onSend={(l) => send(l)}
          snapshot={() => ({ draft, confirmed })} restore={(s) => { setDraft(s.draft); setConfirmed(s.confirmed); }} />
      ) : selected && (
        <DayView form={form} p={selected} fields={fields} cur={cur} setCell={setCell} original={original[selected.period_start] ?? {}}
          zeroState={(f) => zeroState(selected.period_start, f)} confirmZero={(k, on) => confirmZeros(selected.period_start, [k], on)}
          check={check(selected.period_start)} instructions={instructions} busy={busy} dirty={dirty} changed={dirtyOf(selected.period_start)} canSave={savable.length > 0}
          onSave={saveDrafts} onReview={() => setReviewing(selected.period_start)} />
      )}

      {reviewP && form && (
        <ReviewSheet form={form} p={reviewP} fields={fields} cur={cur} setCell={setCell} zeroState={(f) => zeroState(reviewP.period_start, f)}
          confirmZero={(k, on) => confirmZeros(reviewP.period_start, [k], on)} check={check(reviewP.period_start)}
          busy={busy} onClose={() => setReviewing(null)} onSend={(note) => send([reviewP.period_start], note)} officeName={name(officeRef)} />
      )}
      {sent && form && (
        <SentSheet form={form} sent={sent} periods={periods} onClose={() => setSent(null)}
          onNext={(ps) => { setSent(null); go({ period: ps }, true); }} />
      )}
    </RPage>
  );
}

/** After sending: what went, and what's next. */
function SentSheet({ form, sent, periods, onClose, onNext }: {
  form: FormDef; sent: string[]; periods: Submission[]; onClose: () => void; onNext: (ps: string) => void;
}) {
  const { t, tf, lang } = useT();
  const label = (ps: string) => (form.frequency === "weekly" ? rangeText(ps, addDays(ps, 6), lang) : form.frequency === "once" ? formTitle(form, lang) : dayMonth(ps, lang));
  const next = periods.find((p) => !sent.includes(p.period_start) && !p.read_only_reason && (p.status === "none" || p.status === "draft" || p.status === "returned"));
  return (
    <RSheet open onClose={onClose} closeLabel={t("discard")} title={tf("x_is_sent", { day: sent.map(label).join(", ") })}>
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-r-action text-white dark:text-r-ground" aria-hidden>
          <Check className="size-8" strokeWidth={2.6} />
        </span>
        <p className="m-0 text-r-muted">{t("sent_body")}</p>
        {next && (
          <RButton size="lg" variant="pri" className="self-stretch" onClick={() => onNext(next.period_start)}>
            {tf("next_period", { day: label(next.period_start) })}{next.deadline && ` · ${tf("due_by", { when: whenText(next.deadline, lang) })}`}
          </RButton>
        )}
      </div>
    </RSheet>
  );
}

// --------------------------------------------------------------------------- one period (phone first)
type Check = { bad: FormField[]; ask: FormField[]; missing: FormField[]; filled: number };

function statusLine(p: Submission, tr: Tr) {
  if (p.status === "submitted") return tr.t("st_locked_sub");
  if (p.status === "returned") return tr.t("returned_for_change");
  if (p.status === "draft") return tr.tf("draft_saved", { when: p.entered_at ? whenText(p.entered_at, tr.lang) : "" });
  return tr.t("not_saved_yet");
}

function periodTitle(form: FormDef, p: Submission, lang: string) {
  return form.frequency === "daily" ? longDay(p.period_start, lang) : form.frequency === "weekly" ? rangeText(p.period_start, p.period_end, lang) : formTitle(form, lang);
}

function DayView({ form, p, fields, cur, setCell, original, zeroState, confirmZero, check, instructions, busy, dirty, changed, canSave, onSave, onReview }: {
  form: FormDef; p: Submission; fields: FormField[]; cur: (ps: string, k: string) => string; setCell: (ps: string, k: string, v: string) => void;
  original: Record<string, string>; zeroState: (f: FormField) => "none" | "ask" | "ok"; confirmZero: (k: string, on: boolean) => void;
  check: Check; instructions: string; busy: boolean; dirty: boolean; changed: boolean; canSave: boolean; onSave: () => void; onReview: () => void;
}) {
  const tr = useT();
  const { t, tf, lang } = tr;
  const me = useUser();
  const ps = p.period_start;
  const writable = !p.read_only_reason;
  const closed = !!p.read_only_reason?.startsWith("entry closed");  // past 11:59 PM: only the state office edits
  const overdue = isOverdue(p.status, p.deadline);
  const mark: Mark = dirty && writable ? "draft" : markOf(p.status, overdue);
  const corrections = Object.entries(p.corrections);
  const problems = [check.bad.length ? tf("n_problems", { n: check.bad.length }) : "", check.ask.length ? tf("n_zeros", { n: check.ask.length }) : ""].filter(Boolean).join(" · ");
  const groups = Array.from(new Set(fields.map((f) => f.group)));

  return (
    <>
      <div className="flex flex-col">
        <span className="disp text-[22px] font-bold">{periodTitle(form, p, lang)}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-sm text-r-muted">
          <StatusMark mark={mark} late={p.late} size={12} /> {statusLine(p, tr)}
          {p.deadline && (p.status === "none" || p.status === "draft") && <span>· {overdue ? t("overdue") : tf("due_by", { when: whenText(p.deadline, lang) })}</span>}
          {writable && me.role === "district" && <span>· {tf("open_till", { day: dayMonth(p.period_end, lang) })}</span>}
        </span>
      </div>

      {p.status === "returned" && (
        <section className="flex flex-col gap-2.5 rounded-2xl border-[1.5px] border-r-returned bg-r-returned-soft p-4">
          <div className="flex items-center gap-2.5"><StatusMark mark="ret" /><b>{t("returned_for_change")}</b></div>
          {p.review_note && <blockquote className="m-0 rounded-[10px] bg-r-card px-3.5 py-3 text-base">{p.review_note}</blockquote>}
          {p.reviewed_at && <span className="text-sm text-r-returned-ink">{p.reviewed_by || t("state_office")} · {whenText(p.reviewed_at, lang)}</span>}
        </section>
      )}
      {closed ? <RAlert tone="info">{t("entry_locked")}</RAlert>
        : p.read_only_reason && p.status !== "submitted" && <RAlert tone="info">{p.read_only_reason}</RAlert>}

      {instructions.trim() && (
        <details className="rounded-xl bg-r-card px-3.5 py-3" open={p.status === "none" && !dirty ? undefined : undefined}>
          <summary className="min-h-7 cursor-pointer font-bold">{t("instructions_from")}</summary>
          <Instructions text={instructions} className="mt-2" />
        </details>
      )}

      {corrections.length > 0 && (
        <div className="flex flex-col rounded-[14px] bg-r-card">
          <div className="px-3.5 pt-3 pb-1 text-sm font-bold text-r-muted">{t("changed_by_state")}</div>
          {corrections.map(([k, c]) => {
            const f = fields.find((x) => x.key === k);
            if (!f) return null;
            return (
              <div key={k} className="flex items-center justify-between gap-3 border-t border-r-sunk px-3.5 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <b>{fieldLabel(f, lang)}</b>
                  <span className="text-[13px] text-r-muted">{tf("you_sent", { v: "" })}<s className="num">{toText(c.original) || "—"}</s>.{c.note && ` ${c.note}`}</span>
                </div>
                <span className="num px-3.5 text-xl font-semibold"><span className="corr">{showValue(f, cur(ps, k), t)}</span></span>
              </div>
            );
          })}
        </div>
      )}

      {groups.map((g) => (
        <fieldset key={g || "-"} className="m-0 flex flex-col rounded-[14px] border-0 bg-r-card p-0">
          {g && groups.length > 1 && <legend className="sr-only">{groupLabel(g, t)}</legend>}
          {g && groups.length > 1 && <div aria-hidden className="px-3.5 pt-3 text-[13px] font-bold tracking-[0.06em] text-r-muted uppercase">{groupLabel(g, t)}</div>}
          {fields.filter((f) => f.group === g).map((f, i) => (
            <FieldRow key={f.key} f={f} first={i === 0} value={cur(ps, f.key)} disabled={!writable} corrected={!!p.corrections[f.key]}
              changed={cur(ps, f.key) !== (original[f.key] ?? "")} zero={zeroState(f)} problem={problemOf(f, cur(ps, f.key), tr)}
              onChange={(v) => setCell(ps, f.key, v)} onConfirm={(on) => confirmZero(f.key, on)} />
          ))}
        </fieldset>
      ))}

      {(p.status === "submitted" || p.edits.length > 0) && (
        <details className="rounded-xl bg-r-card px-3.5 py-3">
          <summary className="min-h-7 cursor-pointer font-bold">{tf("history_n", { n: p.edits.length })}</summary>
          <ChangeHistory p={p} fields={fields} />
        </details>
      )}

      {writable && (
        <footer className="sticky bottom-0 z-20 -mx-4 mt-auto flex flex-col gap-2.5 border-t border-r-line bg-r-card px-4 pt-3 pb-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:rounded-t-2xl lg:border-x">
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span>{tf("n_entered", { a: check.filled, b: fields.length })}</span>
            {problems && <span className="font-bold text-r-overdue-ink">{problems}</span>}
          </div>
          <div className="flex gap-2.5">
            <RButton size="lg" className="flex-1" loading={busy} disabled={!canSave} onClick={onSave}>{t("save_draft")}</RButton>
            <RButton size="lg" variant="pri" className="flex-[1.4]" disabled={busy || check.filled === 0 || (p.status === "submitted" && !changed)} onClick={onReview}>
              {p.status === "returned" ? t("review_resend") : p.status === "submitted" ? t("review_send_changes") : t("review_submit")}
            </RButton>
          </div>
        </footer>
      )}
    </>
  );
}

/** What changed after the period was sent, newest first, ending with the send itself. */
function ChangeHistory({ p, fields }: { p: Submission; fields: FormField[] }) {
  const { t, tf, lang } = useT();
  const field = (k: string) => fields.find((f) => f.key === k);
  const show = (k: string, v: AnswerValue) => { const f = field(k); return f ? showValue(f, toText(v), t) : toText(v) || "—"; };
  const edits = [...p.edits].reverse();
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {edits.map((e, i) => {
        const f = field(e.key);
        return (
          <li key={e.id} className={cn("flex gap-3 py-3", i > 0 && "border-t border-r-sunk")}>
            <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", e.source === "state" ? "bg-r-corrected" : "bg-r-field")} aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
              <span>{tf(e.reverts ? "undone_log" : "edited_log", { f: f ? fieldLabel(f, lang) : e.key, a: show(e.key, e.before), b: show(e.key, e.after) })}</span>
              <span className="text-r-muted">{whenText(e.at, lang)} · {e.source === "state" ? t("state_office") : t("src_office")} · {e.by}</span>
              {e.note && <span className="rounded-lg bg-r-sunk px-2.5 py-1.5">{e.note}</span>}
            </div>
          </li>
        );
      })}
      {p.submitted_at && (
        <li className={cn("flex gap-3 py-3", edits.length > 0 && "border-t border-r-sunk")}>
          <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-r-action" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
            <span>{t("first_sent")}{p.late ? ` · ${t("late")}` : ""}</span>
            <span className="text-r-muted">{whenText(p.submitted_at, lang)}{p.submitted_by ? ` · ${p.submitted_by}` : ""}</span>
            {!edits.length && <span className="text-r-muted">{t("no_changes_yet")}</span>}
          </div>
        </li>
      )}
    </ol>
  );
}

function groupLabel(g: string, t: Tr["t"]) {
  return ["print", "video", "social", "other"].includes(g) ? t(`group_${g}` as "group_print") : g;
}

function FieldRow({ f, first, value, disabled, corrected, changed, zero, problem, onChange, onConfirm }: {
  f: FormField; first: boolean; value: string; disabled: boolean; corrected: boolean; changed: boolean;
  zero: "none" | "ask" | "ok"; problem: string; onChange: (v: string) => void; onConfirm: (on: boolean) => void;
}) {
  const tr = useT();
  const { t, lang } = tr;
  const id = `f_${f.key}`;
  const hint = hintOf(f, tr);
  const inputCls = cn("h-[54px] w-28 shrink-0 rounded-xl px-3.5 text-right num text-xl font-semibold text-r-ink placeholder:font-body placeholder:text-sm placeholder:font-normal placeholder:text-r-faint disabled:opacity-100",
    "border-[1.5px] border-r-faint bg-r-card shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)] focus:border-r-action focus:outline-2 focus:outline-offset-0 focus:outline-r-action/30",
    zero === "ask" && "border-2 border-solid border-r-returned bg-r-returned-soft",
    problem && "border-2 border-solid border-r-overdue bg-r-overdue-soft text-r-overdue-ink",
    corrected && "text-r-corrected-ink", disabled && "border-solid bg-r-sunk/60", changed && !problem && zero !== "ask" && "border-r-action");
  const wide = f.type === "text" || f.type === "choice" || f.type === "yesno" || f.type === "date";
  const control = f.type === "yesno" || f.type === "choice" ? (
    <RSelect id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn("min-h-[54px] w-full rounded-xl text-base", corrected && "text-r-corrected-ink")}>
      <option value="">{t("choose")}</option>
      {(f.type === "yesno" ? [["yes", t("yes")], ["no", t("no")]] : f.options.map((o) => [o, o])).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </RSelect>
  ) : f.type === "text" ? (
    <RTextarea id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn("text-base", corrected && "text-r-corrected-ink")} />
  ) : f.type === "date" ? (
    <DateInput id={id} big value={value} disabled={disabled} onChange={onChange} className="w-full" />
  ) : (
    <span className={cn("relative", corrected && "[&>input]:pr-6")}>
      <input id={id} type="text" inputMode={f.integer ? "numeric" : "decimal"} placeholder={t("not_entered")} value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value.trim())} aria-invalid={!!problem || undefined}
        aria-describedby={problem || zero !== "none" ? `${id}_m` : undefined} className={inputCls} />
      {corrected && <span aria-hidden className="pointer-events-none absolute top-1.5 right-1.5 border-[5px] border-transparent border-t-r-corrected border-r-r-corrected" />}
    </span>
  );
  return (
    <div className={cn("flex flex-col gap-2 px-3.5 py-3", !first && "border-t border-r-sunk")}>
      <div className={cn("flex gap-3", wide ? "flex-col" : "items-center justify-between")}>
        <label htmlFor={id} className="flex flex-1 flex-col">
          <span className="leading-tight font-bold">{fieldLabel(f, lang)}{f.required && <span className="text-r-overdue" aria-hidden> *</span>}</span>
          {hint && <span className="text-[13px] text-r-muted">{hint}</span>}
        </label>
        {control}
      </div>
      {problem && (
        <div id={`${id}_m`} className="flex items-start gap-2 text-sm font-bold text-r-overdue-ink">
          <AlertCircle className="mt-px size-[18px] shrink-0 text-r-overdue" aria-hidden /> {problem}
        </div>
      )}
      {!problem && zero === "ask" && !disabled && (
        <div id={`${id}_m`} className="flex items-center justify-between gap-2.5 rounded-[10px] bg-r-returned-soft px-2.5 py-2">
          <span className="text-sm text-r-returned-ink">{t("zero_q")}</span>
          <button type="button" onClick={() => onConfirm(true)}
            className="min-h-10 shrink-0 cursor-pointer rounded-[10px] border-[1.5px] border-r-returned-ink bg-r-card px-3.5 text-sm font-bold text-r-returned-ink">{t("yes_zero")}</button>
        </div>
      )}
      {!problem && zero === "ok" && changed && (
        <div id={`${id}_m`} className="flex items-center gap-2 text-sm font-bold text-r-accepted">
          <StatusMark mark="acc" size={12} /> {t("zero_ok")}
          {!disabled && <button type="button" onClick={() => onConfirm(false)} className="ml-auto min-h-8 cursor-pointer border-0 bg-transparent text-sm font-normal text-r-action">{t("undo")}</button>}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- check before sending
function ReviewSheet({ form, p, fields, cur, setCell, zeroState, confirmZero, check, busy, onClose, onSend, officeName }: {
  form: FormDef; p: Submission; fields: FormField[]; cur: (ps: string, k: string) => string; setCell: (ps: string, k: string, v: string) => void;
  zeroState: (f: FormField) => "none" | "ask" | "ok"; confirmZero: (k: string, on: boolean) => void; check: Check; busy: boolean;
  onClose: () => void; onSend: (note: string) => void; officeName: string;
}) {
  const tr = useT();
  const { t, tf, lang } = tr;
  const ps = p.period_start;
  const [note, setNote] = React.useState("");
  const day = form.frequency === "daily" ? dayMonth(ps, lang) : form.frequency === "weekly" ? rangeText(ps, p.period_end, lang) : formTitle(form, lang);
  const zeros = fields.filter((f) => zeroState(f) !== "none");
  /** Blanks the office may still turn into a confirmed 0 here (they were blank, or became 0 on this sheet). */
  const [blankKeys] = React.useState(() => fields.filter((f) => f.type === "number" && !f.required && cur(ps, f.key) === "").map((f) => f.key));
  const blanks = fields.filter((f) => blankKeys.includes(f.key));
  const otherZeros = zeros.filter((f) => !blankKeys.includes(f.key));
  const figures = fields.filter((f) => cur(ps, f.key) !== "" && !(f.type === "number" && Number(cur(ps, f.key)) === 0 && /^\d/.test(cur(ps, f.key))));
  const ready = !check.ask.length && !check.bad.length && !check.missing.length;
  const label = check.bad.length ? t("fix_to_send") : check.missing.length ? tf("required_missing", { list: check.missing.map((f) => fieldLabel(f, lang)).join(", ") })
    : check.ask.length ? tf("confirm_n_to_send", { n: check.ask.length }) : isOverdue(p.status, p.deadline) ? tf("send_day_late", { day }) : tf("send_day", { day });
  return (
    <RSheet open onClose={onClose} closeLabel={t("close_keep_editing")} title={tf("check_before", { day })}
      description={`${formTitle(form, lang)} · ${officeName}`}
      footer={<>
        <RButton size="lg" variant={ready ? "pri" : "default"} disabled={!ready} loading={busy} onClick={() => onSend(note)}
          className={cn("min-h-[54px] whitespace-normal", !ready && "border-r-field bg-r-field text-r-ink opacity-100")}>{label}</RButton>
        <p className="m-0 text-center text-sm text-r-muted">{tf("after_send_locked", { day })}</p>
      </>}>
      {check.bad.length > 0 && (
        <RAlert tone="danger">{check.bad.map((f) => `${fieldLabel(f, lang)}: ${problemOf(f, cur(ps, f.key), tr)}`).join(" · ")}</RAlert>
      )}

      {otherZeros.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="mx-1 my-0 text-[17px] font-bold">{t("zeros_real")}</h2>
          {otherZeros.map((f) => zeroState(f) === "ok" && !otherZerosAsked(f) ? (
            <div key={f.key} className="flex min-h-[52px] items-center gap-3 rounded-xl border-[1.5px] border-r-line bg-r-card px-3 py-2">
              <StatusMark mark="acc" size={22} />
              <span className="flex-1"><b>{fieldLabel(f, lang)}</b> {t("was_zero")} <span className="text-sm text-r-muted">· {t("zero_confirmed_word")}</span></span>
            </div>
          ) : (
            <RCheck plain key={f.key} checked={zeroState(f) === "ok"} onChange={(on) => confirmZero(f.key, on)}
              className={cn("flex min-h-[52px] w-full gap-3 rounded-xl px-3 py-2 text-[15px] [&>span:first-child]:size-6",
                zeroState(f) === "ask" ? "border-2 border-r-returned bg-r-returned-soft" : "border-[1.5px] border-r-line bg-r-card")}>
              <span className="flex-1"><b>{fieldLabel(f, lang)}</b> {t("was_zero")}</span>
            </RCheck>
          ))}
        </section>
      )}

      {blanks.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="mx-1 my-0 text-[17px] font-bold">{t("left_blank")} · {blanks.filter((f) => cur(ps, f.key) === "").length}</h2>
          <p className="mx-1 my-0 text-[15px] text-r-muted">{t("left_blank_help")}</p>
          {blanks.map((f) => {
            const on = cur(ps, f.key) === "0";
            return (
              <RCheck plain key={f.key} checked={on} onChange={(v) => { if (v) { setCell(ps, f.key, "0"); confirmZero(f.key, true); } else setCell(ps, f.key, ""); }}
                className="flex min-h-[52px] w-full gap-3 rounded-xl border-[1.5px] border-r-line bg-r-card px-3 py-2 text-[15px] [&>span:first-child]:size-6">
                <span className="flex-1"><b>{fieldLabel(f, lang)}</b> {t("was_zero")}</span>
              </RCheck>
            );
          })}
        </section>
      )}

      {figures.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="mx-1 my-0 text-[17px] font-bold">{t("your_figures")}</h2>
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 rounded-xl bg-r-card px-3.5 py-1.5 text-[15px]">
            {figures.map((f, i) => (
              <React.Fragment key={f.key}>
                <dt className={cn("py-[7px]", i < figures.length - 1 && "border-b border-r-sunk")}>{fieldLabel(f, lang)}</dt>
                <dd className={cn("m-0 py-[7px] text-right font-semibold", f.type === "number" && "num", i < figures.length - 1 && "border-b border-r-sunk", p.corrections[f.key] && "text-r-corrected-ink")}>
                  {showValue(f, cur(ps, f.key), t)}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      )}

      <RLabel label={t("note_optional")}>
        <RTextarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-20 text-base" />
      </RLabel>
    </RSheet>
  );

  function otherZerosAsked(f: FormField) {
    // a zero confirmed on this visit stays a checkbox so it can be unticked
    return cur(ps, f.key) !== toText(p.values[f.key]);
  }
}

// --------------------------------------------------------------------------- several periods (desktop sheet)
type Snapshot = { draft: Draft; confirmed: Set<string> };

function SheetView({ form, periods, fields, cur, setCell, original, zeroState, check, confirmZeros, dirtyOf, busy, instructions,
  onSave, savable, blockedDirty, dirtyCount, onDiscard, onSend, snapshot, restore }: {
  form: FormDef; periods: Submission[]; fields: FormField[]; cur: (ps: string, k: string) => string; setCell: (ps: string, k: string, v: string) => void;
  original: Draft; zeroState: (ps: string, f: FormField) => "none" | "ask" | "ok"; check: (ps: string) => Check;
  confirmZeros: (ps: string, keys: string[], on?: boolean) => void; dirtyOf: (ps: string) => boolean; busy: boolean; instructions: string;
  onSave: () => void; savable: number; blockedDirty: number; dirtyCount: number; onDiscard: () => void; onSend: (list: string[]) => void;
  snapshot: () => Snapshot; restore: (s: Snapshot) => void;
}) {
  const tr = useT();
  const { t, tf, lang } = tr;
  const tableRef = React.useRef<HTMLTableElement>(null);
  const [pasted, setPasted] = React.useState<{ snap: Snapshot; rows: number; cols: number; from: string; zeros: number } | null>(null);
  const label = (ps: string, p?: Submission) => form.frequency === "weekly" ? rangeText(ps, p?.period_end ?? addDays(ps, 6), lang) : shortDay(ps, lang);

  const focusCell = (r: number, c: number) => {
    const el = tableRef.current?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
    if (el) { el.focus(); if (el instanceof HTMLInputElement) el.select(); }
  };
  // Tab with nothing focused yet jumps straight to the first box the office can fill, skipping the header links.
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      if (document.activeElement && document.activeElement !== document.body) return;
      const el = tableRef.current?.querySelector<HTMLInputElement | HTMLSelectElement>("[data-r]:not(:disabled)");
      if (!el) return;
      e.preventDefault();
      el.focus();
      if (el instanceof HTMLInputElement) el.select();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const onKey = (e: React.KeyboardEvent<HTMLElement>, r: number, c: number) => {
    const el = e.currentTarget as HTMLInputElement;
    const atStart = !(el instanceof HTMLInputElement) || (el.selectionStart === 0 && el.selectionEnd === 0);
    const atEnd = !(el instanceof HTMLInputElement) || el.selectionStart === el.value.length;
    const move: Record<string, [number, number] | undefined> = {
      ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], Enter: [r + 1, c],
      ArrowLeft: atStart ? [r, c - 1] : undefined, ArrowRight: atEnd ? [r, c + 1] : undefined,
    };
    const to = move[e.key];
    if (to && !(e.key === "Enter" && el.tagName === "SELECT")) { e.preventDefault(); focusCell(to[0], to[1]); return; }
    if ((e.key === "Delete") && el instanceof HTMLInputElement) { e.preventDefault(); setCell(periods[r].period_start, fields[c].key, ""); }
  };
  // Paste a block copied from Excel: tab-separated columns, newline-separated periods, starting at the focused cell.
  const onPaste = (e: React.ClipboardEvent, pi: number, fi: number) => {
    const text = e.clipboardData.getData("text");
    if (!/[\t\n]/.test(text)) return;
    e.preventDefault();
    const snap = snapshot();
    const lines = text.replace(/\r/g, "").split("\n").filter((l, i, a) => l !== "" || i < a.length - 1);
    let zeros = 0, cols = 0;
    lines.forEach((line, r) => {
      const p = periods[pi + r];
      if (!p || p.read_only_reason) return;
      const cells = line.split("\t");
      cols = Math.max(cols, cells.length);
      cells.forEach((cell, c) => {
        const f = fields[fi + c];
        if (!f) return;
        const v = cell.trim();
        if (f.type === "number" && v !== "" && Number(v.replace(/[^\d.]/g, "")) === 0) zeros++;
        setCell(p.period_start, f.key, v);
      });
    });
    setPasted({ snap, rows: lines.length, cols: Math.min(cols, fields.length - fi), from: label(periods[pi].period_start), zeros });
  };

  // The send panel: every writable period with something in it not sent yet, and sent ones with changes.
  const candidates = periods.filter((p) => !p.read_only_reason && (p.status === "submitted" ? dirtyOf(p.period_start)
    : ["none", "draft", "returned"].includes(p.status) && fields.some((f) => cur(p.period_start, f.key) !== "")));
  const [historyOf, setHistoryOf] = React.useState<Submission | null>(null);
  const readyOf = (ps: string) => { const c = check(ps); return !c.bad.length && !c.ask.length && !c.missing.length; };
  const [unticked, setUnticked] = React.useState<Set<string>>(new Set());
  const toSend = candidates.filter((p) => readyOf(p.period_start) && !unticked.has(p.period_start)).map((p) => p.period_start);
  const emptyOpen = periods.filter((p) => !p.read_only_reason && p.status === "none" && !fields.some((f) => cur(p.period_start, f.key) !== ""));

  return (
    <>
      {pasted && (
        <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-xl bg-r-action-soft px-4 py-3 text-r-action-hover dark:text-r-ink">
          <ClipboardPaste className="size-5" aria-hidden />
          <span><b>{tf("pasted", { r: pasted.rows, c: pasted.cols, day: pasted.from })}</b>{pasted.zeros > 0 && <> {tf("pasted_zeros", { n: pasted.zeros })}</>}</span>
          <RButton size="sm" className="ml-auto" onClick={() => { restore(pasted.snap); setPasted(null); }}>{t("undo")}</RButton>
        </div>
      )}

      <div className="flex flex-col gap-5">
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="max-h-[560px] overflow-auto rounded-xl border border-r-line bg-r-card scrollbar-thin">
            <table ref={tableRef} className="w-full border-separate border-spacing-0 text-sm" aria-label={`${formTitle(form, lang)} · ${rangeText(periods[0].period_start, periods.at(-1)!.period_start, lang)}`}>
              <thead className="sticky top-0 z-20">
                <tr>
                  <th scope="col" className="sticky left-0 z-30 min-w-40 border-b border-r border-r-line bg-r-card px-3 py-2 text-left text-xs font-bold text-r-muted">{t("period")}</th>
                  {fields.map((f) => (
                    <th key={f.key} scope="col" className="min-w-[84px] border-b border-r-line bg-r-card px-1.5 py-2 text-right align-bottom text-xs leading-tight font-bold text-r-muted">
                      {fieldLabel(f, lang)}{f.required && <span className="text-r-overdue" aria-hidden>*</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map((p, r) => {
                  const ps = p.period_start;
                  const w = !p.read_only_reason;
                  const mark: Mark = dirtyOf(ps) && w ? "draft" : markOf(p.status, isOverdue(p.status, p.deadline));
                  const tint = p.status === "returned" ? "bg-r-returned-soft" : !w ? "bg-r-sunk/50" : "bg-r-card";
                  return (
                    <tr key={ps} className={tint}>
                      <th scope="row" className={cn("sticky left-0 z-10 border-r border-b border-r-line px-3 py-1.5 text-left font-normal", tint)}>
                        <div className="flex items-center justify-between gap-2.5">
                          <span className="flex flex-col leading-tight">
                            <b className="num text-sm">{label(ps, p)}</b>
                            <span className="text-xs text-r-muted">{w ? statusWord(p, mark, t) : <span className="inline-flex items-center gap-1"><Lock className="size-3" aria-hidden />{statusWord(p, mark, t)}</span>}</span>
                          </span>
                          {(p.status === "submitted" || p.edits.length > 0) && (
                            <button type="button" onClick={() => setHistoryOf(p)} title={tf("history_n", { n: p.edits.length })} aria-label={`${label(ps, p)} · ${tf("history_n", { n: p.edits.length })}`}
                              className="inline-flex min-h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1.5 text-xs text-r-muted hover:bg-r-sunk hover:text-r-ink">
                              <History className="size-3.5" aria-hidden />
                            </button>
                          )}
                        </div>
                        {p.status === "returned" && p.review_note && <div className="mt-0.5 max-w-52 truncate text-xs text-r-returned-ink" title={p.review_note}>“{p.review_note}”</div>}
                      </th>
                      {fields.map((f, c) => {
                        const v = cur(ps, f.key);
                        const z = zeroState(ps, f);
                        const prob = problemOf(f, v, tr);
                        const corr = p.corrections[f.key];
                        const changed = v !== (original[ps]?.[f.key] ?? "");
                        const cls = cn("h-9 w-full min-w-[72px] rounded-md border border-r-field bg-r-card px-1.5 text-right num text-sm font-semibold text-r-ink no-spin shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)] enabled:hover:border-r-faint focus:border-r-action focus:outline-2 focus:outline-offset-0 focus:outline-r-action/30 disabled:cursor-default disabled:shadow-none",
                          z === "ask" && "border-2 border-solid border-r-returned bg-r-returned-soft",
                          prob && "border-2 border-solid border-r-overdue bg-r-overdue-soft text-r-overdue-ink",
                          corr && "text-r-corrected-ink", !w && "border-transparent bg-transparent", changed && !prob && z !== "ask" && "border-r-action");
                        const title = prob || (z === "ask" ? t("zero_q") : corr ? `${t("corrected")}: ${t("original")} ${toText(corr.original) || "—"}${corr.note ? ` · ${corr.note}` : ""}` : undefined);
                        return (
                          <td key={f.key} className="relative border-b border-r-line p-1" title={title}>
                            {f.type === "yesno" || f.type === "choice" ? (
                              <select data-r={r} data-c={c} value={v} disabled={!w} aria-label={`${label(ps, p)} ${fieldLabel(f, lang)}`}
                                onChange={(e) => setCell(ps, f.key, e.target.value)} onKeyDown={(e) => onKey(e, r, c)} className={cn(cls, "text-left font-normal")}>
                                <option value="">–</option>
                                {(f.type === "yesno" ? [["yes", t("yes")], ["no", t("no")]] : f.options.map((o) => [o, o])).map(([ov, ol]) => <option key={ov} value={ov}>{ol}</option>)}
                              </select>
                            ) : (
                              <input data-r={r} data-c={c} type={f.type === "date" ? "date" : "text"} value={v} disabled={!w}
                                inputMode={f.type === "number" ? (f.integer ? "numeric" : "decimal") : undefined}
                                aria-label={`${label(ps, p)} ${fieldLabel(f, lang)}`} aria-invalid={!!prob || undefined}
                                onChange={(e) => setCell(ps, f.key, e.target.value)} onKeyDown={(e) => onKey(e, r, c)} onPaste={(e) => onPaste(e, r, c)}
                                className={cn(cls, f.type !== "number" && "text-left font-normal")} />
                            )}
                            {z === "ask" && <span aria-hidden className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[11px] font-bold text-r-returned-ink">?</span>}
                            {corr && <span aria-hidden className="pointer-events-none absolute top-1 right-1 border-[5px] border-transparent border-t-r-corrected border-r-r-corrected" />}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 text-[13px] text-r-muted">
            <span className="text-xs font-bold text-r-ink">{t("kb_title")}</span>
            <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[auto_1fr_auto_1fr] sm:gap-x-4">
              {SHORTCUTS.map(([keys, k]) => (
                <React.Fragment key={k}>
                  <dt className="flex items-center gap-1 whitespace-nowrap">
                    {keys.map((key, j) => <React.Fragment key={key}>{j > 0 && <span aria-hidden>+</span>}<kbd className="kbd">{key}</kbd></React.Fragment>)}
                  </dt>
                  <dd className="m-0">{t(k)}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
          {instructions.trim() && (
            <details id="instructions" className="rounded-xl bg-r-card px-3.5 py-3">
              <summary className="cursor-pointer font-bold">{t("instructions_from")}</summary>
              <Instructions text={instructions} className="mt-2" />
            </details>
          )}
        </div>

        <aside aria-label={t("send_title")} className="flex w-full flex-col gap-3.5 rounded-[14px] bg-r-card p-[18px]">
          <h2 className="m-0 text-lg font-bold">{t("send_title")}</h2>
          {candidates.length > 0 && <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">{candidates.map((p) => {
            const ps = p.period_start;
            const c = check(ps);
            const ready = !c.bad.length && !c.ask.length && !c.missing.length;
            const over = isOverdue(p.status, p.deadline);
            const head = `${label(ps, p)} · ${p.status === "submitted" ? t("sent_changed") : p.status === "returned" ? t("sub_returned") : over ? t("overdue") : p.status === "draft" ? t("sub_draft") : t("sub_none")}`;
            const tone = c.bad.length || c.missing.length ? "border-r-overdue" : c.ask.length ? "border-r-returned bg-r-returned-soft" : "border-r-line";
            return (
              <div key={ps} className={cn("flex items-start gap-2.5 rounded-[10px] border-[1.5px] p-3", tone)}>
                <RCheck plain id={`send_${ps}`} disabled={!ready} checked={ready && !unticked.has(ps)} className="mt-0.5 [&>span:first-child]:size-5"
                  onChange={(on) => setUnticked((prev) => { const n = new Set(prev); if (on) n.delete(ps); else n.add(ps); return n; })} />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <label htmlFor={`send_${ps}`} className="font-bold">{head}</label>
                  {c.bad.length > 0 && <span className="text-sm font-bold text-r-overdue-ink">{fieldLabel(c.bad[0], lang)} {cur(ps, c.bad[0].key)}: {problemOf(c.bad[0], cur(ps, c.bad[0].key), tr)}</span>}
                  {!c.bad.length && c.missing.length > 0 && <span className="text-sm font-bold text-r-overdue-ink">{tf("required_missing", { list: c.missing.map((f) => fieldLabel(f, lang)).join(", ") })}</span>}
                  {!c.bad.length && !c.missing.length && c.ask.length > 0 && (
                    <>
                      <span className="text-sm text-r-returned-ink">{tf("zeros_q_list", { list: c.ask.map((f) => fieldLabel(f, lang)).join(", ") })}</span>
                      <RButton size="sm" className="self-start border-r-returned-ink text-r-returned-ink" onClick={() => confirmZeros(ps, c.ask.map((f) => f.key))}>
                        {c.ask.length > 1 ? t("yes_all_zero") : t("yes_zero")}
                      </RButton>
                    </>
                  )}
                  {ready && <span className="text-sm text-r-muted">{tf("n_entered", { a: c.filled, b: fields.length })}. {t("ready_word")}</span>}
                </div>
              </div>
            );
          })}</div>}
          {emptyOpen.length > 0 && candidates.length > 0 && (
            <div className="text-sm text-r-muted">{emptyOpen.map((p) => label(p.period_start, p)).join(", ")}: {t("not_saved_yet")}</div>
          )}
          <RButton size="lg" variant="pri" className="w-full" disabled={!toSend.length || busy} loading={busy} onClick={() => onSend(toSend)}>
            {toSend.length ? tf("send_n", { n: toSend.length <= 3 ? toSend.map((ps) => label(ps)).join(", ") : String(toSend.length) }) : t("send_title")}
          </RButton>
          <p className="m-0 flex items-start gap-2 text-[13px] text-r-muted">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{candidates.length === 0 && `${t("nothing_to_send")} `}{t("sent_lock_note")}</span>
          </p>
          {dirtyCount > 0 && (
            <div className="flex flex-col gap-2 border-t border-r-line pt-3">
              <span className="text-sm font-bold">{dirtyCount} · {t("unsaved")}</span>
              {blockedDirty > 0 && <span className="text-[13px] text-r-returned-ink">{t("zeros_need_confirm")}</span>}
              <div className="flex flex-wrap gap-2">
                <RButton size="sm" loading={busy} disabled={!savable} onClick={onSave}>{t("save_draft")} <span className="kbd">Ctrl S</span></RButton>
                <RButton size="sm" variant="ghost" onClick={() => { onDiscard(); setPasted(null); }}>{t("discard")}</RButton>
              </div>
            </div>
          )}
        </aside>
      </div>

      {historyOf && (
        <RSheet open onClose={() => setHistoryOf(null)} closeLabel={t("close")} title={`${t("edit_history")} · ${label(historyOf.period_start, historyOf)}`} description={formTitle(form, lang)}>
          <ChangeHistory p={historyOf} fields={fields} />
        </RSheet>
      )}
    </>
  );
}

function statusWord(p: Submission, mark: Mark, t: Tr["t"]) {
  if (mark === "draft" && p.status !== "draft") return t("unsaved");
  const map: Record<Mark, TKey> = { pend: "st_pending", draft: "sub_draft", over: "overdue", sub: "sub_submitted", acc: "sub_accepted", ret: "sub_returned", na: "st_na" };
  return t(map[mark]) + (p.late && mark !== "over" && mark !== "pend" && mark !== "draft" ? ` · ${t("late")}` : "");
}
