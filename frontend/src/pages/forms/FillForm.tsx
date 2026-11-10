import * as React from "react";
import { Link, useBlocker, useParams, useSearchParams } from "react-router-dom";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Check, ChevronLeft, Loader2, Pencil, Undo2 } from "lucide-react";
import { api, ApiError, type AnswerValue, type FormDef, type FormField, type LinkCheck, type PeriodsResponse, type Proof, type Submission } from "@/lib/api";
import { useMeta } from "@/lib/hooks";
import { useUser } from "@/lib/auth";
import { useT, type TKey } from "@/lib/i18n";
import { addDays, cn } from "@/lib/utils";
import { RAlert, RButton, RCheck, RError, RLabel, RPage, RSelect, RSheet, RTextarea, StatusMark, markOf, type Mark } from "@/components/reports/kit";
import { DateInput } from "@/components/reports/DateInput";
import { dayMonth, entryClosed, isOverdue, longDay, periodOf, rangeText, whenText } from "@/components/reports/period";
import { Instructions } from "./MyForms";
import { fieldLabel, formTitle, groupName, useToday } from "./common";
import {
  EMPTY, FileBox, LinkLines, LinksInput, ProofList, fieldTakesFiles, fieldTakesLinks, parseLinks, proofDraftOf,
  proofPayload, sameProof, uploadPicked, type FileItem, type ProofDraft,
} from "./ProofBox";

type Draft = Record<string, Record<string, string>>; // period_start -> field key -> text ("" = blank)
type ProofDrafts = Record<string, Record<string, ProofDraft>>; // period_start -> field key -> links text + files
type Tr = ReturnType<typeof useT>;

function toText(v: AnswerValue | undefined) { return v === null || v === undefined ? "" : String(v); }
const ck = (ps: string, k: string) => `${ps}|${k}`;

/** Why a typed value can't be saved, or "" when it's fine. */
export function problemOf(f: FormField, v: string, tr: Tr) {
  if (v === "" || f.type !== "number") return "";
  if (!/^\d+(\.\d+)?$/.test(v)) return tr.t("digits_only");
  if (f.integer && !/^\d+$/.test(v)) return tr.t("whole_only");
  const n = Number(v);
  if (f.min_value !== null && n < f.min_value) return tr.tf("below_min", { min: f.min_value });
  if (f.max_value !== null && n > f.max_value) return tr.tf("above_max", { max: f.max_value });
  return "";
}

function hintOf(f: FormField, tr: Tr, oneLinkEach: boolean) {
  const help = tr.lang === "en" ? f.help_en || f.help_mr : f.help_mr;
  const parts = [f.required ? tr.t("required") : "", f.type === "number" && f.max_value !== null ? tr.tf("range_hint", { min: f.min_value ?? 0, max: f.max_value }) : "",
    oneLinkEach ? tr.t("proof_links_hint") : "", help];
  return parts.filter(Boolean).join(" · ");
}

function showValue(f: FormField, v: string, t: Tr["t"]) {
  if (v === "") return "—";
  if (f.type === "yesno") return v === "yes" ? t("yes") : t("no");
  return v;
}

/** `value`, once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => { const h = setTimeout(() => setV(value), ms); return () => clearTimeout(h); }, [value, ms]);
  return v;
}

/** The server's verdict on each pasted link of one field, and whether it is still catching up with the typing. */
type LinkState = { checks?: LinkCheck[]; checking: boolean };

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

  const officesAll = meta?.divisions.flatMap((d) => d.offices) ?? [];
  const office = params.get("office") || (me.role === "district" ? me.office?.code ?? "" : "");
  const requested = params.get("period") || today;

  const { data: formDef, error: formError } = useQuery({ queryKey: ["form", formId], enabled: !!formId, queryFn: () => api.get<FormDef>(`/api/forms/${formId}`) });
  const lastDay = formDef?.end_date && formDef.end_date < today ? formDef.end_date : today;
  // every period of the form so far: the strip shows them all, the page one at a time
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
  const proofFields = React.useMemo(() => fields.filter((f) => f.type === "number" && f.proof !== "none"), [fields]);
  const periods = React.useMemo(() => data?.periods ?? [], [data]);
  const selected = periods.find((p) => p.period_start === (form ? periodOf(form, requested) : "")) ?? periods[periods.length - 1];
  /** Proof applies to this period: the form asks for it and the period isn't from before the rule. */
  const proofOn = React.useCallback((ps: string) => !!form?.proof_from && ps >= form.proof_from, [form]);

  const original = React.useMemo(() => {
    const o: Draft = {};
    periods.forEach((p) => { o[p.period_start] = Object.fromEntries(fields.map((f) => [f.key, toText(p.values[f.key])])); });
    return o;
  }, [periods, fields]);
  const proofOrig = React.useMemo(() => {
    const o: ProofDrafts = {};
    periods.forEach((p) => { o[p.period_start] = Object.fromEntries(proofFields.map((f) => [f.key, proofDraftOf(p.proofs?.[f.key])])); });
    return o;
  }, [periods, proofFields]);
  const [draft, setDraft] = React.useState<Draft>({});
  const [proofDraft, setProofDraft] = React.useState<ProofDrafts>({});
  /** New zeros the office has said are real (saved zeros are confirmed already). */
  const [confirmed, setConfirmed] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [reviewing, setReviewing] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<string[] | null>(null);
  React.useEffect(() => { setDraft(original); setProofDraft({}); setConfirmed(new Set()); }, [original, proofOrig]);

  const cur = React.useCallback((ps: string, k: string) => draft[ps]?.[k] ?? original[ps]?.[k] ?? "", [draft, original]);
  const proofOf = React.useCallback((ps: string, k: string) => proofDraft[ps]?.[k] ?? proofOrig[ps]?.[k] ?? EMPTY, [proofDraft, proofOrig]);
  const proofChanged = (ps: string, k: string) => !sameProof(proofOf(ps, k), proofOrig[ps]?.[k]);
  const dirtyOf = (ps: string) => fields.some((f) => cur(ps, f.key) !== (original[ps]?.[f.key] ?? "")) || proofFields.some((f) => proofChanged(ps, f.key));
  const dirtyPeriods = periods.filter((p) => dirtyOf(p.period_start)).map((p) => p.period_start);
  const dirty = dirtyPeriods.length > 0;
  const uploading = Object.values(proofDraft).some((byKey) => Object.values(byKey).some((d) => d.files.some((f) => f.status === "uploading")));

  // live link checks for the open period (debounced), the same checks the server applies on save
  const selPs = selected?.period_start ?? "";
  const linkFields = proofFields.filter(fieldTakesLinks);
  const wantChecks = linkFields.map((f) => [f.key, parseLinks(proofOf(selPs, f.key).linksText).join("\n")] as const);
  const checkKey = JSON.stringify(wantChecks);
  const debounced = useDebounced(checkKey, 500);
  const checkedNow = JSON.parse(debounced) as [string, string][];
  const checksOn = !!selPs && proofOn(selPs) && !selected?.read_only_reason;
  const checkResults = useQueries({
    queries: checkedNow.map(([k, text]) => ({
      queryKey: ["proof-check", formId, office, selPs, k, text],
      enabled: checksOn && text !== "",
      staleTime: 30_000,
      queryFn: () => api.post<{ links: LinkCheck[] }>(`/api/forms/${formId}/proof-check`, { office, period: selPs, field: k, text }),
    })),
  });
  const linkState = (ps: string, k: string): LinkState => {
    if (ps !== selPs || !checksOn) return { checking: false };
    const want = wantChecks.find(([key]) => key === k)?.[1] ?? "";
    const i = checkedNow.findIndex(([key, text]) => key === k && text === want);
    const q = i >= 0 ? checkResults[i] : undefined;
    return { checks: q?.data?.links, checking: want !== "" && (!q || q.isFetching || (!q.data && !q.isError)) };
  };

  const isZero = (f: FormField, v: string) => f.type === "number" && v !== "" && /^\d+(\.\d+)?$/.test(v) && Number(v) === 0;
  const zeroState = (ps: string, f: FormField): "none" | "ask" | "ok" => {
    const v = cur(ps, f.key);
    if (!isZero(f, v)) return "none";
    return original[ps]?.[f.key] === v || confirmed.has(ck(ps, f.key)) ? "ok" : "ask";
  };
  /** Why a field's proof can't be saved (red links, more links than the number, number and links differ), or "". */
  const proofProblem = (ps: string, f: FormField) => {
    if (!proofOn(ps) || !fieldTakesLinks(f)) return "";
    const links = parseLinks(proofOf(ps, f.key).linksText);
    if (linkState(ps, f.key).checks?.some((c) => c.problem)) return t("proof_fix_links");
    const n = Number(cur(ps, f.key) || 0);
    if (f.proof === "either" && links.length > n) return t("proof_more_links");
    if (f.proof === "links" && links.length && links.length !== n) return tf("proof_links_match", { n: links.length });
    return "";
  };
  /** A figure above 0 without its PDF/photo or link (optional: flagged, never blocks sending). */
  const needsProof = (ps: string, f: FormField) => {
    if (!proofOn(ps) || !fieldTakesFiles(f)) return false;
    const v = cur(ps, f.key);
    if (!/^\d+(\.\d+)?$/.test(v) || Number(v) <= 0) return false;
    const d = proofOf(ps, f.key);
    return !parseLinks(d.linksText).length && !d.files.some((x) => x.status === "done");
  };
  const fieldProblem = (ps: string, f: FormField) => problemOf(f, cur(ps, f.key), tr) || proofProblem(ps, f);
  const check = (ps: string) => {
    const bad = fields.filter((f) => fieldProblem(ps, f));
    const ask = fields.filter((f) => zeroState(ps, f) === "ask");
    const missing = fields.filter((f) => f.required && cur(ps, f.key) === "");
    const noProof = fields.filter((f) => needsProof(ps, f));
    const filled = fields.filter((f) => cur(ps, f.key) !== "").length;
    const checking = linkFields.some((f) => linkState(ps, f.key).checking);
    return { bad, ask, missing, noProof, filled, checking };
  };

  // unsaved-changes guard: in-app navigation and tab close
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (dirty || uploading) && currentLocation.pathname !== nextLocation.pathname);
  React.useEffect(() => {
    if (blocker.state === "blocked") { if (confirm(t("unsaved_leave"))) blocker.proceed(); else blocker.reset(); }
  }, [blocker, t]);
  React.useEffect(() => {
    if (!dirty && !uploading) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty, uploading]);
  const go = (patch: Record<string, string>, keepDraft = false) => {
    if ((dirty || uploading) && !keepDraft && !confirm(t("unsaved_leave"))) return;
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
  const setProof = (ps: string, k: string, fn: (d: ProofDraft) => ProofDraft) => setProofDraft((prev) => {
    const d = prev[ps]?.[k] ?? proofOrig[ps]?.[k] ?? EMPTY;
    return { ...prev, [ps]: { ...prev[ps], [k]: fn(d) } };
  });
  const setLinks = (ps: string, f: FormField, text: string) => setProof(ps, f.key, (d) => ({ ...d, linksText: text }));
  const addFiles = (ps: string, f: FormField, list: File[]) => {
    const upd = (uid: string, p: Partial<FileItem>) => setProof(ps, f.key, (d) => ({ ...d, files: d.files.map((x) => (x.uid === uid ? { ...x, ...p } : x)) }));
    void uploadPicked(list, { formId, office, ps, field: f.key }, (it) => setProof(ps, f.key, (d) => ({ ...d, files: [...d.files, it] })), upd, t);
  };
  const removeFile = (ps: string, f: FormField, uid: string) => setProof(ps, f.key, (d) => ({ ...d, files: d.files.filter((x) => x.uid !== uid) }));

  const payload = (ps: string) => {
    const values = Object.fromEntries(fields.map((f) => {
      const v = cur(ps, f.key);
      return [f.key, v === "" ? null : f.type === "number" ? Number(v) : v];
    }));
    const changed = proofFields.filter((f) => proofChanged(ps, f.key));
    return { values, confirm_zero: true, proofs: changed.length ? Object.fromEntries(changed.map((f) => [f.key, proofPayload(proofOf(ps, f.key))])) : null };
  };
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["form-periods"] });
    qc.invalidateQueries({ queryKey: ["forms-mine"] });
    qc.invalidateQueries({ queryKey: ["proof-check"] });
  };
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await refresh(); return true; }
    catch (e) { toast.error(e instanceof ApiError ? e.message : String(e)); qc.invalidateQueries({ queryKey: ["form-periods"] }); return false; }
    finally { setBusy(false); }
  };
  /** Periods whose edits can be saved now: no bad figure or link, no zero waiting for a yes. */
  const savable = uploading ? [] : dirtyPeriods.filter((ps) => { const c = check(ps); return !c.bad.length && !c.ask.length; });
  const saveDrafts = () => run(async () => {
    for (const ps of savable) await api.put(`/api/forms/${formId}/submissions/${office}/${ps}`, payload(ps));
  }, t("saved"));
  const send = async (list: string[], note = "") => {
    const ok = await run(async () => {
      for (const ps of list) {
        await api.put(`/api/forms/${formId}/submissions/${office}/${ps}`, { ...payload(ps), note: note || null, submit: true });
      }
      // other edited periods are kept as drafts alongside
      for (const ps of savable.filter((x) => !list.includes(x))) {
        await api.put(`/api/forms/${formId}/submissions/${office}/${ps}`, payload(ps));
      }
    }, t("sub_submitted"));
    if (ok) { setReviewing(null); setSent(list); }
  };
  const returnToOffice = async (ps: string, note: string) => {
    const ok = await run(async () => { await api.post(`/api/forms/${formId}/submissions/${office}/${ps}/return`, { note }); }, t("returned_ok"));
    return ok;
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
  // keep the chosen day visible in the strip (scrolls the strip only, never the page)
  const stripRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>("[aria-selected=true]");
    if (strip && tab) strip.scrollLeft = tab.offsetLeft - strip.offsetLeft - (strip.clientWidth - tab.clientWidth) / 2;
  }, [selected?.period_start, periods.length]);
  const reviewP = periods.find((p) => p.period_start === reviewing);
  const wide = proofFields.length > 0;

  const proofProps = (p: Submission): ProofHooks => ({
    on: proofOn(p.period_start), of: (k) => proofOf(p.period_start, k), saved: (k) => p.proofs?.[k] ?? [], links: (k) => linkState(p.period_start, k),
    onLinks: (f, text) => setLinks(p.period_start, f, text), onPick: (f, list) => addFiles(p.period_start, f, list),
    onRemove: (f, uid) => removeFile(p.period_start, f, uid), needs: (f) => needsProof(p.period_start, f),
  });

  return (
    <RPage className={cn("mx-auto w-full gap-4", wide ? "max-w-[720px] lg:max-w-[1120px]" : "max-w-[720px]")}>
      {/* ---------------------------------------------------------------- header */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 items-start gap-1">
            <Link to={back} aria-label={t("back")} className="-ml-2.5 flex size-11 shrink-0 items-center justify-center rounded-lg text-r-ink hover:bg-r-sunk">
              <ChevronLeft className="size-6" aria-hidden />
            </Link>
            <div className="flex min-w-0 flex-col">
              <h1 className="m-0 text-[19px] leading-[1.15] font-bold lg:text-[24px]">{form ? formTitle(form, lang) : "…"}</h1>
              <span className="hidden text-sm text-r-muted sm:inline">{name(officeRef)}</span>
            </div>
          </div>
          {officePicker && <div className="flex flex-wrap items-end gap-3">{officePicker}</div>}
        </div>

        {form && form.frequency !== "once" && periods.length > 0 && (
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
                    <StatusMark className="hidden sm:inline-flex" mark={dirtyOf(p.period_start) ? "draft" : markOf(p.status, isOverdue(p.status, p.deadline))} late={p.late} />
                    <DayDot className="sm:hidden" kind={dotOf(p)} />
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {form && form.frequency !== "once" && periods.length > 0 && (
          <div className="flex gap-4 text-[13px] text-r-muted sm:hidden">
            {(["sent", "missed", "fill"] as const).map((k) => (
              <span key={k} className="flex items-center gap-1.5"><DayDot kind={k} decorative />{t(DOT_LABEL[k])}</span>
            ))}
          </div>
        )}
      </header>

      {me.role === "zone" && <RAlert tone="info">{t("read_only")}</RAlert>}

      {error ? <RError error={error} /> : isLoading || !data || !form ? (
        <div className="flex flex-col gap-3" aria-busy>{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-r-sunk" />)}</div>
      ) : !periods.length ? (
        <RAlert tone="info">{t("rows_none")}</RAlert>
      ) : selected && (
        <DayView form={form} p={selected} office={office} fields={fields} cur={cur} setCell={setCell} original={original[selected.period_start] ?? {}}
          zeroState={(f) => zeroState(selected.period_start, f)} confirmZero={(k, on) => confirmZeros(selected.period_start, [k], on)}
          check={check(selected.period_start)} fieldProblem={(f) => fieldProblem(selected.period_start, f)} proof={proofProps(selected)}
          instructions={instructions} busy={busy} uploading={uploading} dirty={dirty} changed={dirtyOf(selected.period_start)} canSave={savable.length > 0}
          onSave={saveDrafts} onReview={() => setReviewing(selected.period_start)} onReturn={(note) => returnToOffice(selected.period_start, note)} />
      )}

      {reviewP && form && (
        <ReviewSheet form={form} p={reviewP} fields={fields} cur={cur} zeroState={(f) => zeroState(reviewP.period_start, f)}
          confirmZero={(k, on) => confirmZeros(reviewP.period_start, [k], on)} check={check(reviewP.period_start)}
          fieldProblem={(f) => fieldProblem(reviewP.period_start, f)} uploading={uploading}
          busy={busy} onClose={() => setReviewing(null)} onSend={(note) => send([reviewP.period_start], note)} officeName={name(officeRef)} />
      )}
      {sent && form && (
        <SentSheet form={form} sent={sent} periods={periods} onClose={() => setSent(null)}
          onNext={(ps) => { setSent(null); go({ period: ps }, true); }} />
      )}
    </RPage>
  );
}

/** Day strip: one plain coloured circle per day on phones — sent, missed, or still to fill. */
type DotKind = "sent" | "missed" | "fill";
const DOT_LABEL: Record<DotKind, TKey> = { sent: "dot_sent", missed: "dot_missed", fill: "dot_to_fill" };
const DOT_BG: Record<DotKind, string> = { sent: "bg-r-accepted", missed: "bg-r-overdue", fill: "bg-r-focus" };

/** Missed once entry has closed (11:59 PM) or the deadline passed with nothing sent; a returned day is open again. */
function dotOf(p: Submission): DotKind {
  if (p.status === "submitted") return "sent";
  if (p.status === "returned") return "fill";
  return isOverdue(p.status, p.deadline) || entryClosed(p.period_end) ? "missed" : "fill";
}

function DayDot({ kind, decorative, className }: { kind: DotKind; decorative?: boolean; className?: string }) {
  const { t } = useT();
  return <span className={cn("inline-block size-3 flex-none rounded-full", DOT_BG[kind], className)}
    role={decorative ? undefined : "img"} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : t(DOT_LABEL[kind])} />;
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

// --------------------------------------------------------------------------- one period
type Check = { bad: FormField[]; ask: FormField[]; missing: FormField[]; noProof: FormField[]; filled: number; checking: boolean };

/** Everything a field row needs for its proof box, bound to one period. */
type ProofHooks = {
  on: boolean; of: (k: string) => ProofDraft; saved: (k: string) => Proof[]; links: (k: string) => LinkState; needs: (f: FormField) => boolean;
  onLinks: (f: FormField, text: string) => void; onPick: (f: FormField, list: File[]) => void; onRemove: (f: FormField, uid: string) => void;
};

function statusLine(p: Submission, tr: Tr) {
  if (p.status === "submitted") return tr.t("st_locked_sub");
  if (p.status === "returned") return tr.t("returned_for_change");
  if (p.status === "draft") return tr.tf("draft_saved", { when: p.entered_at ? whenText(p.entered_at, tr.lang) : "" });
  return tr.t("not_saved_yet");
}

function periodTitle(form: FormDef, p: Submission, lang: string) {
  return form.frequency === "daily" ? longDay(p.period_start, lang) : form.frequency === "weekly" ? rangeText(p.period_start, p.period_end, lang) : formTitle(form, lang);
}

function DayView({ form, p, office, fields, cur, setCell, original, zeroState, confirmZero, check, fieldProblem, proof, instructions, busy, uploading, dirty, changed, canSave, onSave, onReview, onReturn }: {
  form: FormDef; p: Submission; office: string; fields: FormField[]; cur: (ps: string, k: string) => string; setCell: (ps: string, k: string, v: string) => void;
  original: Record<string, string>; zeroState: (f: FormField) => "none" | "ask" | "ok"; confirmZero: (k: string, on: boolean) => void;
  check: Check; fieldProblem: (f: FormField) => string; proof: ProofHooks; instructions: string; busy: boolean; uploading: boolean; dirty: boolean;
  changed: boolean; canSave: boolean; onSave: () => void; onReview: () => void; onReturn: (note: string) => Promise<boolean>;
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
  const problems = [check.bad.length ? tf("n_problems", { n: check.bad.length }) : "", check.ask.length ? tf("n_zeros", { n: check.ask.length }) : "",
    check.noProof.length ? tf("n_proof_missing", { n: check.noProof.length }) : ""].filter(Boolean).join(" · ");
  const groups = Array.from(new Set(fields.map((f) => f.group)));
  const [returning, setReturning] = React.useState(false);
  const exemptLine = p.proof_exempt && fields.some((f) => f.proof !== "none");

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col">
          <span className="disp text-[22px] font-bold">{periodTitle(form, p, lang)}</span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-sm text-r-muted">
            <StatusMark mark={mark} late={p.late} size={12} /> {statusLine(p, tr)}
            {p.deadline && (p.status === "none" || p.status === "draft") && <span>· {overdue ? t("overdue") : tf("due_by", { when: whenText(p.deadline, lang) })}</span>}
            {writable && me.role === "district" && <span>· {tf("open_till", { day: dayMonth(p.period_end, lang) })}</span>}
          </span>
        </div>
        {me.role === "state" && (
          <div className="flex flex-wrap gap-2">
            <RButton asChild size="sm">
              <Link to={`/forms/responses?form=${form.id}&day=${ps}&office=${office}`}><Pencil aria-hidden /> {t("edit_values")}</Link>
            </RButton>
            {p.status === "submitted" && <RButton size="sm" variant="danger" onClick={() => setReturning(true)}><Undo2 aria-hidden /> {t("return_to_office")}</RButton>}
          </div>
        )}
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
        <details className="rounded-xl bg-r-card px-3.5 py-3">
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

      {exemptLine && <p className="m-0 px-1 text-sm text-r-muted">{t("proof_exempt")}</p>}

      {groups.map((g) => (
        <fieldset key={g || "-"} className="m-0 flex min-w-0 flex-col rounded-[14px] border-0 bg-r-card p-0">
          {groups.length > 1 && <legend className="sr-only">{groupName(g, form.group_names, t)}</legend>}
          {groups.length > 1 && <div aria-hidden className="px-3.5 pt-3 text-[13px] font-bold tracking-[0.06em] text-r-muted uppercase">{groupName(g, form.group_names, t)}</div>}
          {fields.filter((f) => f.group === g).map((f, i) => (
            <FieldRow key={f.key} formId={form.id} f={f} first={i === 0} value={cur(ps, f.key)} disabled={!writable} corrected={!!p.corrections[f.key]}
              changed={cur(ps, f.key) !== (original[f.key] ?? "")} zero={zeroState(f)} problem={fieldProblem(f)} proof={proof}
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
            <span>{uploading ? <span className="inline-flex items-center gap-1.5 font-bold"><Loader2 className="size-4 animate-spin" aria-hidden />{t("proof_uploading")}</span>
              : tf("n_entered", { a: check.filled, b: fields.length })}</span>
            {problems && <span className="font-bold text-r-overdue-ink">{problems}</span>}
          </div>
          <div className="flex gap-2.5">
            <RButton size="lg" className="flex-1" loading={busy} disabled={!canSave} onClick={onSave}>{t("save_draft")}</RButton>
            <RButton size="lg" variant="pri" className="flex-[1.4]" disabled={busy || uploading || check.filled === 0 || (p.status === "submitted" && !changed)} onClick={onReview}>
              {p.status === "returned" ? t("review_resend") : p.status === "submitted" ? t("review_send_changes") : t("review_submit")}
            </RButton>
          </div>
        </footer>
      )}

      {returning && <ReturnSheet busy={busy} onClose={() => setReturning(false)} onSend={async (note) => { if (await onReturn(note)) setReturning(false); }} />}
    </>
  );
}

/** The state office sends a sent day back to the office with a note saying what to fix. */
function ReturnSheet({ busy, onClose, onSend }: { busy: boolean; onClose: () => void; onSend: (note: string) => void }) {
  const { t } = useT();
  const [note, setNote] = React.useState("");
  return (
    <RSheet open onClose={onClose} closeLabel={t("close")} title={t("return_to_office")}
      footer={<RButton size="lg" variant="danger" disabled={!note.trim()} loading={busy} onClick={() => onSend(note.trim())}><Undo2 aria-hidden /> {t("return_send")}</RButton>}>
      <RLabel label={t("return_note_label")}>
        <RTextarea value={note} autoFocus onChange={(e) => setNote(e.target.value)} className="min-h-28 text-base" />
      </RLabel>
    </RSheet>
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

/** One question. A field that asks for proof gets its proof box beside the number on wide screens, under it on phones. */
function FieldRow({ formId, f, first, value, disabled, corrected, changed, zero, problem, proof, onChange, onConfirm }: {
  formId: number; f: FormField; first: boolean; value: string; disabled: boolean; corrected: boolean; changed: boolean;
  zero: "none" | "ask" | "ok"; problem: string; proof: ProofHooks; onChange: (v: string) => void; onConfirm: (on: boolean) => void;
}) {
  const tr = useT();
  const { t, lang } = tr;
  const id = `f_${f.key}`;
  const withProof = proof.on && f.type === "number" && f.proof !== "none";
  const hint = hintOf(f, tr, withProof && f.proof === "links");
  const pd = proof.of(f.key);
  const links = parseLinks(pd.linksText);
  const ls = proof.links(f.key);
  const needs = withProof && proof.needs(f);
  const inputCls = cn("h-[54px] w-28 shrink-0 rounded-xl px-3 text-center num text-xl font-semibold text-r-ink placeholder:font-body placeholder:text-sm placeholder:font-normal placeholder:text-r-faint disabled:opacity-100",
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
        onChange={(e) => onChange(e.target.value.trim())} aria-invalid={!!problem || needs || undefined}
        aria-describedby={problem || needs || zero !== "none" ? `${id}_m` : undefined} className={inputCls} />
      {corrected && <span aria-hidden className="pointer-events-none absolute top-1.5 right-1.5 border-[5px] border-transparent border-t-r-corrected border-r-r-corrected" />}
    </span>
  );
  const message = problem || (needs ? t(f.proof === "files" ? "proof_needed_files" : "proof_needed") : "");
  // read-only: a blank or zero figure with nothing attached needs no "no proof" line
  const quiet = disabled && !proof.saved(f.key).length && !(Number(value) > 0);
  const box = withProof && !quiet && (
    <div className="flex min-w-0 flex-col gap-2" aria-label={`${t("proof_word")} · ${fieldLabel(f, lang)}`} role="group">
      <span className="text-[13px] font-bold text-r-muted">{t("proof_word")} · {t(`proof_type_${f.proof}` as TKey)}</span>
      {disabled ? <ProofList formId={formId} proofs={proof.saved(f.key)} /> : (
        <>
          {fieldTakesLinks(f) && (
            <>
              <LinksInput id={`${id}_links`} value={pd.linksText} onChange={(v) => proof.onLinks(f, v)} />
              <LinkLines links={links} checks={ls.checks} checking={ls.checking} />
            </>
          )}
          {fieldTakesFiles(f) && <FileBox formId={formId} files={pd.files} onPick={(list) => proof.onPick(f, list)} onRemove={(uid) => proof.onRemove(f, uid)} />}
        </>
      )}
    </div>
  );
  return (
    <div className={cn("flex flex-col gap-2 px-3.5 py-3", !first && "border-t border-r-sunk", withProof && "lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8")}>
      <div className="flex min-w-0 flex-col gap-2">
        <div className={cn("flex gap-3", wide ? "flex-col" : "items-center justify-between")}>
          <label htmlFor={id} className="flex flex-1 flex-col">
            <span className="leading-tight font-bold">{fieldLabel(f, lang)}{f.required && <span className="text-r-overdue" aria-hidden> *</span>}</span>
            {hint && <span className="text-[13px] text-r-muted">{hint}</span>}
          </label>
          {control}
        </div>
        {message && (
          <div id={`${id}_m`} className="flex items-start gap-2 text-sm font-bold text-r-overdue-ink">
            <AlertCircle className="mt-px size-[18px] shrink-0 text-r-overdue" aria-hidden /> {message}
          </div>
        )}
        {!message && zero === "ask" && !disabled && (
          <div id={`${id}_m`} className="flex items-center justify-between gap-2.5 rounded-[10px] bg-r-returned-soft px-2.5 py-2">
            <span className="text-sm text-r-returned-ink">{t("zero_q")}</span>
            <button type="button" onClick={() => onConfirm(true)}
              className="min-h-10 shrink-0 cursor-pointer rounded-[10px] border-[1.5px] border-r-returned-ink bg-r-card px-3.5 text-sm font-bold text-r-returned-ink">{t("yes_zero")}</button>
          </div>
        )}
        {!message && zero === "ok" && changed && (
          <div id={`${id}_m`} className="flex items-center gap-2 text-sm font-bold text-r-accepted">
            <StatusMark mark="acc" size={12} /> {t("zero_ok")}
            {!disabled && <button type="button" onClick={() => onConfirm(false)} className="ml-auto min-h-8 cursor-pointer border-0 bg-transparent text-sm font-normal text-r-action">{t("undo")}</button>}
          </div>
        )}
      </div>
      {box}
    </div>
  );
}

// --------------------------------------------------------------------------- check before sending
function ReviewSheet({ form, p, fields, cur, zeroState, confirmZero, check, fieldProblem, uploading, busy, onClose, onSend, officeName }: {
  form: FormDef; p: Submission; fields: FormField[]; cur: (ps: string, k: string) => string;
  zeroState: (f: FormField) => "none" | "ask" | "ok"; confirmZero: (k: string, on: boolean) => void; check: Check; fieldProblem: (f: FormField) => string;
  uploading: boolean; busy: boolean; onClose: () => void; onSend: (note: string) => void; officeName: string;
}) {
  const tr = useT();
  const { t, tf, lang } = tr;
  const ps = p.period_start;
  const [note, setNote] = React.useState("");
  const day = form.frequency === "daily" ? dayMonth(ps, lang) : form.frequency === "weekly" ? rangeText(ps, p.period_end, lang) : formTitle(form, lang);
  const otherZeros = fields.filter((f) => zeroState(f) !== "none");
  const figures = fields.filter((f) => cur(ps, f.key) !== "" && !(f.type === "number" && Number(cur(ps, f.key)) === 0 && /^\d/.test(cur(ps, f.key))));
  const ready = !check.ask.length && !check.bad.length && !check.missing.length && !check.checking && !uploading;
  const label = check.bad.length ? t("fix_to_send") : check.missing.length ? tf("required_missing", { list: check.missing.map((f) => fieldLabel(f, lang)).join(", ") })
    : uploading ? t("proof_uploading") : check.checking ? t("links_checking")
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
        <RAlert tone="danger">{check.bad.map((f) => `${fieldLabel(f, lang)}: ${fieldProblem(f)}`).join(" · ")}</RAlert>
      )}
      {check.noProof.length > 0 && (
        <RAlert tone="info">
          {check.noProof.map((f) => `${fieldLabel(f, lang)}: ${t(f.proof === "files" ? "proof_needed_files" : "proof_needed")}`).join(" · ")}
        </RAlert>
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
