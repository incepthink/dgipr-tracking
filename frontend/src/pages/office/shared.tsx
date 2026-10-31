import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { api, type Compliance, type ComplianceRow, type FormDef, type ResponsesData } from "@/lib/api";
import { useMeta } from "@/lib/hooks";
import { useUser } from "@/lib/auth";
import { useT, type TKey } from "@/lib/i18n";
import { addDays, cn, qs } from "@/lib/utils";
import { RButton, RChip, RInput, RLabel, RSelect, RSheet, StatusMark, markOf, type Mark } from "@/components/reports/kit";
import { dayMonth, deadlineOf, isOverdue, periodOf, rangeText, sameIstDay, shortDay, stepOf, timeOf, whenText } from "@/components/reports/period";
import { formTitle, type FormFilters } from "../forms/common";

// --------------------------------------------------------------------------- filters
export function FormPicker({ f, label = true, className }: { f: FormFilters; label?: boolean; className?: string }) {
  const { t, lang } = useT();
  if (!f.forms?.length) return null;
  const select = (
    <RSelect aria-label={t("form")} value={f.formId} className={cn("max-w-full min-w-56", className)}
      onChange={(e) => f.set({ form: e.target.value, start: null, end: null, day: null })}>
      {f.forms.map((x) => <option key={x.id} value={x.id}>{formTitle(x, lang)}{x.status === "draft" ? ` (${t("status_draft")})` : ""}</option>)}
    </RSelect>
  );
  return label ? <RLabel small label={t("form")}>{select}</RLabel> : select;
}

export function DivisionPicker({ f }: { f: FormFilters }) {
  const me = useUser();
  const { data: meta } = useMeta();
  const { t } = useT();
  if (me.role !== "state") return null;
  return (
    <RLabel small label={t("division")}>
      <RSelect value={f.division} onChange={(e) => f.set({ division: e.target.value, office: null })}>
        <option value="">{t("all_divisions")}</option>
        {meta?.divisions.map((d) => <option key={d.code} value={d.code}>{d.label_mr}</option>)}
      </RSelect>
    </RLabel>
  );
}

/** One office (district) within the chosen division, in official order; hidden when the user sees only one. */
export function OfficePicker({ f }: { f: FormFilters }) {
  const { data: meta } = useMeta();
  const { t, name } = useT();
  const divs = meta?.divisions.filter((d) => !f.division || d.code === f.division) ?? [];
  if (divs.flatMap((d) => d.offices).length < 2) return null;
  return (
    <RLabel small label={t("office_filter")}>
      <RSelect value={f.office} className="max-w-64" onChange={(e) => f.set({ office: e.target.value })}>
        <option value="">{t("all_offices")}</option>
        {divs.map((d) => (
          <optgroup key={d.code} label={d.label_mr}>
            {d.offices.map((o) => <option key={o.code} value={o.code}>{name(o)}</option>)}
          </optgroup>
        ))}
      </RSelect>
    </RLabel>
  );
}

// --------------------------------------------------------------------------- campaign search
export type FormState = "open" | "ended" | "draft";

/** Open: published and not past its end date. Ended: closed, archived or past its end date. */
export function formState(form: Pick<FormDef, "status" | "end_date">, today: string): FormState {
  if (form.status === "draft") return "draft";
  if (form.status === "published" && !(form.end_date && today && form.end_date < today)) return "open";
  return "ended";
}

const STATE_LABEL: Record<FormState, TKey> = { open: "cs_open", ended: "cs_ended", draft: "status_draft" };

export function FormStateChip({ state }: { state: FormState }) {
  const { t } = useT();
  return <RChip tone={state === "open" ? "ink" : state === "draft" ? "outline" : "plain"} className="shrink-0">{t(STATE_LABEL[state])}</RChip>;
}

/** "3 – 16 Oct", or "3 Oct →" while a form has no end date. */
export function formRange(form: Pick<FormDef, "start_date" | "end_date">, lang: string) {
  return form.end_date ? rangeText(form.start_date, form.end_date, lang) : `${dayMonth(form.start_date, lang)} →`;
}

const RECENT_KEY = "reports.recentForms";

function readRecent(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number").slice(0, 3) : [];
  } catch { return []; }
}

function pushRecent(id: number) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 3))); }
  catch { /* storage unavailable */ }
}

const norm = (s: string) => s.normalize("NFC").toLowerCase();

/** The campaign bar's picker: search forms by Marathi / English title, slug or campaign; grouped Open / Ended / Drafts. */
export function CampaignSearch({ f, open, onClose }: { f: FormFilters; open: boolean; onClose: () => void }) {
  const { t, tf, lang } = useT();
  const me = useUser();
  const { data: meta } = useMeta();
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [recent, setRecent] = React.useState<number[]>([]);
  React.useEffect(() => {
    if (open) { setQ(""); setActive(0); setRecent(readRecent()); }
  }, [open]);

  const campaignOf = React.useCallback((x: FormDef) => meta?.campaigns.find((c) => c.id === x.campaign_id), [meta]);
  const forms = (f.forms ?? []).filter((x) => x.status !== "draft" || me.role === "state");
  const needle = norm(q.trim());
  const hits = !needle ? forms : forms.filter((x) => {
    const c = campaignOf(x);
    return [x.title_mr, x.title_en, x.slug, c?.title_mr ?? "", c?.title_en ?? ""].some((s) => norm(s).includes(needle));
  });
  const groups: { key: string; label: string; items: FormDef[] }[] = [];
  if (!needle) {
    const rec = recent.map((id) => forms.find((x) => x.id === id)).filter((x): x is FormDef => !!x);
    if (rec.length) groups.push({ key: "recent", label: t("cs_recent"), items: rec });
  }
  (["open", "ended", "draft"] as const).forEach((s) => {
    const items = hits.filter((x) => formState(x, f.today) === s);
    if (items.length) groups.push({ key: s, label: t(s === "draft" ? "cs_drafts" : s === "open" ? "cs_open" : "cs_ended"), items });
  });
  const flat = groups.flatMap((g) => g.items.map((x) => ({ g: g.key, x })));
  const cur = Math.min(active, Math.max(0, flat.length - 1));
  const optId = (i: number) => `cs-opt-${i}`;

  const pick = (x: FormDef) => {
    pushRecent(x.id);
    if (x.id !== f.formId) f.set({ form: x.id, start: null, end: null, day: null });
    onClose();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!flat.length) return;
    const move = (i: number) => {
      e.preventDefault();
      setActive(i);
      document.getElementById(optId(i))?.scrollIntoView({ block: "nearest" });
    };
    if (e.key === "ArrowDown") move((cur + 1) % flat.length);
    else if (e.key === "ArrowUp") move((cur - 1 + flat.length) % flat.length);
    else if (e.key === "Home" && e.ctrlKey) move(0);
    else if (e.key === "End" && e.ctrlKey) move(flat.length - 1);
    else if (e.key === "Enter") { e.preventDefault(); pick(flat[cur].x); }
  };

  let i = -1;
  return (
    <RSheet open={open} onClose={onClose} closeLabel={t("close")} title={t("cs_title")} wide>
      <RInput big autoFocus type="search" value={q} placeholder={t("cs_search")} aria-label={t("cs_search")}
        role="combobox" aria-expanded aria-controls="cs-list" aria-autocomplete="list"
        aria-activedescendant={flat.length ? optId(cur) : undefined}
        onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey} />
      <div id="cs-list" role="listbox" aria-label={t("cs_title")} className="flex flex-col gap-3">
        {!flat.length && <p className="m-0 text-r-muted">{tf("cs_no_match", { q: q.trim() })}</p>}
        {groups.map((g) => (
          <div key={g.key} role="group" aria-label={g.label} className="flex flex-col gap-1">
            <div className="px-1 text-xs font-bold tracking-[0.05em] text-r-muted uppercase">{g.label}</div>
            {g.items.map((x) => {
              i++;
              const idx = i;
              const c = campaignOf(x);
              const isCur = x.id === f.formId;
              return (
                <div key={x.id} id={optId(idx)} role="option" aria-selected={idx === cur} aria-current={isCur || undefined}
                  onMouseMove={() => idx !== cur && setActive(idx)} onClick={() => pick(x)}
                  className={cn("flex cursor-pointer items-start gap-3 rounded-xl border-[1.5px] px-3 py-2.5",
                    idx === cur ? "border-r-action bg-r-action-soft" : "border-transparent bg-r-card hover:bg-r-sunk")}>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-bold wrap-break-word">{formTitle(x, lang)}</span>
                    {c && <span className="text-sm text-r-muted">{formTitle(c, lang)}</span>}
                    <span className="num text-[13px] text-r-muted">{formRange(x, lang)}</span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <RChip>{t(`freq_${x.frequency}` as TKey)}</RChip>
                    {isCur && <span className="flex items-center gap-1 text-xs font-bold text-r-action"><Check className="size-3.5" aria-hidden />{t("cs_current")}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </RSheet>
  );
}

/** ‹ label › stepping through periods. */
export function Stepper({ label, onPrev, onNext, prevOk = true, nextOk = true }: {
  label: React.ReactNode; onPrev: () => void; onNext: () => void; prevOk?: boolean; nextOk?: boolean;
}) {
  const { t } = useT();
  return (
    <span className="flex items-center gap-1.5">
      <RButton size="sm" className="min-h-8 px-2" aria-label={t("earlier")} disabled={!prevOk} onClick={onPrev}>‹</RButton>
      <b className="num px-1 whitespace-nowrap">{label}</b>
      <RButton size="sm" className="min-h-8 px-2" aria-label={t("later")} disabled={!nextOk} onClick={onNext}>›</RButton>
    </span>
  );
}

// --------------------------------------------------------------------------- periods
/** The period the desk is about: the open one due soonest, else the latest one that has started. */
export function reportingPeriod(form: FormDef, lastDay: string, now = Date.now()) {
  const last = periodOf(form, lastDay);
  if (form.frequency === "once") return form.start_date;
  const step = stepOf(form);
  for (let i = 3; i >= 0; i--) {
    const ps = addDays(last, -i * step);
    if (ps < form.start_date) continue;
    const dl = deadlineOf(form, ps);
    if (dl && dl.getTime() > now) return ps;
  }
  return last;
}

/** n periods ending at `end` (clamped to the form's start). */
export function windowOf(form: FormDef, end: string, n: number) {
  if (form.frequency === "once") return { start: form.start_date, end: form.start_date };
  const e = periodOf(form, end);
  const s = addDays(e, -(n - 1) * stepOf(form));
  return { start: s < form.start_date ? form.start_date : s, end: e };
}

export function periodName(form: FormDef, ps: string, lang: string) {
  return form.frequency === "weekly" ? rangeText(ps, addDays(ps, 6), lang) : form.frequency === "once" ? formTitle(form, lang) : dayMonth(ps, lang);
}

// --------------------------------------------------------------------------- data
export function useResponses(formId: number, start: string, end: string, division = "", enabled = true) {
  const q = qs({ start, end, division });
  return useQuery({
    queryKey: ["responses", formId, q], enabled: enabled && !!formId && !!start && !!end, placeholderData: (p) => p,
    queryFn: () => api.get<ResponsesData>(`/api/forms/${formId}/responses${q}`),
  });
}

export function useCompliance(formId: number, start: string, end: string, division = "", enabled = true) {
  const q = qs({ start, end, division });
  return useQuery({
    queryKey: ["compliance", formId, q], enabled: enabled && !!formId && !!start && !!end, placeholderData: (p) => p,
    queryFn: () => api.get<Compliance>(`/api/forms/${formId}/compliance${q}`),
  });
}

export type CellInfo = { mark: Mark; late: boolean; overdue: boolean; sent: boolean };

/** Every compliance cell as drawn, with overdue worked out from the form's deadline. */
export function cellInfo(form: FormDef, ps: string, c: ComplianceRow["cells"][number], now = Date.now()): CellInfo {
  const overdue = isOverdue(c.status, deadlineOf(form, ps), now);
  const sent = c.status === "submitted" || c.status === "returned";
  return { mark: markOf(c.status, overdue), late: c.late, overdue, sent };
}

export function rollStats(form: FormDef, data: Compliance, now = Date.now()) {
  let due = 0, onTime = 0, late = 0, returned = 0, overdue = 0, open = 0, toReview = 0;
  data.rows.forEach((r) => r.cells.forEach((c, j) => {
    const i = cellInfo(form, data.periods[j], c, now);
    const dl = deadlineOf(form, data.periods[j]);
    if (i.sent || !dl || dl.getTime() < now) due++;
    if (i.sent && !c.late) onTime++;
    if (i.sent && c.late) late++;
    if (c.status === "returned") returned++;
    if (c.status === "submitted") toReview++;
    if (i.overdue) overdue++;
    if (!i.sent && !i.overdue) open++;
  }));
  return { due, onTime, late, returned, overdue, open, toReview };
}

/** Offices with nothing sent for period j, grouped by division in official order. */
export function notSentBy(data: Compliance, j: number) {
  const out: { division: string; division_mr: string; rows: ComplianceRow[] }[] = [];
  data.rows.forEach((r) => {
    const c = r.cells[j];
    if (!c || c.status === "submitted" || c.status === "returned") return;
    const last = out.at(-1);
    if (last && last.division === r.division) last.rows.push(r);
    else out.push({ division: r.division, division_mr: r.division_mr, rows: [r] });
  });
  return out;
}

/** The WhatsApp chase message: bold uses *asterisks*; offices listed under their division. */
export function chaseText({ form, data, j, withOld, onlyOverdue, tr, now = Date.now() }: {
  form: FormDef; data: Compliance; j: number; withOld: boolean; onlyOverdue?: boolean; tr: ReturnType<typeof useT>; now?: number;
}) {
  const { tf, name, lang } = tr;
  const title = formTitle(form, lang);
  const olderOverdue = (r: ComplianceRow) => r.cells.map((c, k) => ({ c, k }))
    .filter(({ c, k }) => k !== j && cellInfo(form, data.periods[k], c, now).overdue).map(({ k }) => dayMonth(data.periods[k], lang));
  let text: string;
  if (onlyOverdue) {
    text = `*${tf("chase_overdue_head", { form: title })}*\n${tr.t("chase_please")}\n`;
    const groups = new Map<string, string[]>();
    data.rows.forEach((r) => {
      const days = r.cells.map((c, k) => ({ c, k })).filter(({ c, k }) => cellInfo(form, data.periods[k], c, now).overdue).map(({ k }) => dayMonth(data.periods[k], lang));
      if (!days.length) return;
      const g = groups.get(r.division_mr) ?? [];
      g.push(`${name(r)} (${days.join(", ")})`);
      groups.set(r.division_mr, g);
    });
    groups.forEach((list, dv) => { text += `\n*${dv}:* ${list.join(", ")}`; });
    return text;
  }
  const ps = data.periods[j];
  const dl = deadlineOf(form, ps);
  const due = !dl ? "" : dl.getTime() > now
    ? (sameIstDay(dl, new Date(now)) ? tf("due_today_by", { time: timeOf(dl, lang) }) : tf("due_by", { when: whenText(dl, lang) }))
    : tf("was_due_short", { when: whenText(dl, lang) });
  text = `*${tf("chase_head", { form: title, day: periodName(form, ps, lang) })}*\n${due ? due + ". " : ""}${tr.t("chase_please")}\n`;
  notSentBy(data, j).forEach((g) => {
    const list = g.rows.map((r) => {
      const old = withOld ? olderOverdue(r) : [];
      return old.length ? `${name(r)} (${tf("also_days", { days: old.join(", ") })})` : name(r);
    });
    text += `\n*${g.division_mr}:* ${list.join(", ")}`;
  });
  return text;
}

export async function copyText(text: string, ok: string) {
  try { await navigator.clipboard.writeText(text); toast.success(ok); return true; }
  catch { toast.error("Clipboard unavailable"); return false; }
}

export function CopyButton({ text, label, done, variant = "default", size = "sm", className }: {
  text: string; label: string; done: string; variant?: "default" | "pri"; size?: "sm" | "md"; className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => setCopied(false), [text]);
  return (
    <RButton variant={variant} size={size} className={className} onClick={async () => setCopied(await copyText(text, done))}>
      <Copy aria-hidden /> {copied ? done : label}
    </RButton>
  );
}

// --------------------------------------------------------------------------- roll call
/** Offices in official order down, periods across, one mark per cell; division bands between groups. */
export function RollCall({ form, data, highlight, onPick, extraCols = "sent" }: {
  form: FormDef; data: Compliance; highlight?: number; onPick?: (j: number) => void; extraCols?: "sent" | "ontime";
}) {
  const { t, tf, name, lang } = useT();
  const now = Date.now();
  const multiDiv = new Set(data.rows.map((r) => r.division)).size > 1;
  const word = (i: CellInfo, status: string) => (i.overdue ? t("overdue") : t(`sub_${status}` as TKey)) + (i.late ? ` · ${t("late")}` : "");
  const head = (ps: string) => form.frequency === "daily"
    ? new Date(ps + "T00:00:00").toLocaleDateString(lang === "mr" ? "mr-IN" : "en-IN", { weekday: "narrow" }) + " " + new Date(ps + "T00:00:00").getDate()
    : dayMonth(ps, lang);
  // open on the latest periods: on a phone the oldest days are the least useful
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { if (box.current) box.current.scrollLeft = box.current.scrollWidth; }, [data.end]);
  return (
    <div ref={box} className="overflow-x-auto scrollbar-thin">
      <table className="border-separate border-spacing-0 text-[13px]" aria-label={tf("roll_call_of", { range: rangeText(data.start, data.end, lang) })}>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-20 bg-r-card px-2 pb-2 text-left text-xs font-bold text-r-muted">{t("office")}</th>
            {data.periods.map((ps, j) => (
              <th key={ps} scope="col" className={cn("w-8 min-w-8 px-0 pb-2 text-center text-[11px] leading-tight font-bold text-r-muted", j === highlight && "text-r-ink shadow-[inset_0_-3px_0_var(--r-focus)]")}>
                {onPick ? <button type="button" onClick={() => onPick(j)} className="cursor-pointer border-0 bg-transparent p-0 font-bold text-inherit">{head(ps)}</button> : head(ps)}
              </th>
            ))}
            <th scope="col" className="pb-2 pl-3.5 text-right text-xs font-bold text-r-muted">{extraCols === "sent" ? t("sent") : t("on_time")}</th>
            {extraCols === "sent" && <th scope="col" className="pr-1 pb-2 pl-3.5 text-right text-xs font-bold text-r-muted">{t("late")}</th>}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => {
            const band = multiDiv && (i === 0 || data.rows[i - 1].division !== r.division);
            const infos = r.cells.map((c, j) => cellInfo(form, data.periods[j], c, now));
            const sent = infos.filter((x) => x.sent).length;
            const late = r.cells.filter((c, j) => infos[j].sent && c.late).length;
            const divRows = band ? data.rows.filter((x) => x.division === r.division) : [];
            const hj = highlight ?? data.periods.length - 1;
            const divSent = divRows.filter((x) => cellInfo(form, data.periods[hj], x.cells[hj], now).sent).length;
            return (
              <React.Fragment key={r.code}>
                {band && (
                  <tr>
                    <th scope="rowgroup" colSpan={data.periods.length + 1} className="sticky left-0 h-[30px] bg-r-sunk px-2 text-left font-bold">{r.division_mr}</th>
                    <td colSpan={extraCols === "sent" ? 2 : 1} className="num bg-r-sunk pr-1 pl-3.5 text-right text-xs font-bold whitespace-nowrap">
                      {tf("n_of_m_on", { a: divSent, b: divRows.length, day: dayMonth(data.periods[hj], lang) })}
                    </td>
                  </tr>
                )}
                <tr>
                  <th scope="row" title={name(r)} className={cn("sticky left-0 z-10 h-[26px] max-w-[130px] truncate sm:max-w-[230px] border-t border-r-line-soft bg-r-card pr-3.5 text-left font-medium whitespace-nowrap", multiDiv ? "pl-5" : "pl-2")}>{name(r)}</th>
                  {r.cells.map((c, j) => (
                    <td key={j} title={`${name(r)}, ${shortDay(data.periods[j], lang)}: ${word(infos[j], c.status)}`}
                      className={cn("h-[26px] w-8 min-w-8 border-t border-r-line-soft p-0 text-center", j === highlight && "bg-r-today")}>
                      <StatusMark mark={infos[j].mark} late={infos[j].late} />
                    </td>
                  ))}
                  <td className="num border-t border-r-line-soft pl-3.5 text-right font-semibold">
                    {extraCols === "sent" ? `${sent}/${r.cells.length}` : sent ? `${Math.round((100 * (sent - late)) / Math.max(1, infos.filter((x) => x.sent || x.overdue).length))}%` : "—"}
                  </td>
                  {extraCols === "sent" && <td className="num border-t border-r-line-soft pr-1 pl-3.5 text-right text-r-late">{late || ""}</td>}
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function WhatsAppBox({ text }: { text: string }) {
  return (
    <pre className="m-0 rounded-xl border border-[#bfdccb] bg-[#e9f5ee] p-3.5 font-body text-sm leading-normal whitespace-pre-wrap text-[#10261a] dark:border-r-line dark:bg-r-accepted-soft dark:text-[#d5eadf]">{text}</pre>
  );
}
