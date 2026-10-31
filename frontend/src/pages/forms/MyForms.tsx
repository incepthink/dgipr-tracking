import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Bell, CheckCircle2, ChevronRight, ClipboardList } from "lucide-react";
import { api, type InboxForm, type PeriodsResponse, type Submission } from "@/lib/api";
import { useMeta } from "@/lib/hooks";
import { useUser } from "@/lib/auth";
import { useT, type TKey } from "@/lib/i18n";
import { addDays, cn, qs } from "@/lib/utils";
import { RCard, RError, RPage, RSearch, RSheet, RTitle, StatusMark } from "@/components/reports/kit";
import {
  dayMonth, isOverdue, longDay, periodOf, rangeText, stepOf, whenText,
} from "@/components/reports/period";
import { formTitle, useToday } from "./common";

export function useInbox(enabled = true) {
  return useQuery({ queryKey: ["forms-mine"], enabled, queryFn: () => api.get<InboxForm[]>("/api/forms/mine"), staleTime: 30_000 });
}

/** Periods a district office can still fill (open today, or returned) across its forms (sidebar badge). */
export function useInboxCount() {
  const me = useUser();
  const { data } = useInbox(me.role === "district");
  return (data ?? []).reduce((n, f) => n + f.to_fill, 0);
}

export function Instructions({ text, className }: { text: string; className?: string }) {
  if (!text.trim()) return null;
  return (
    <ul className={cn("m-0 flex flex-col gap-1 pl-0 text-[15px] leading-relaxed text-r-muted", className)}>
      {text.split("\n").filter((l) => l.trim()).map((l, i) => <li key={i} className="list-none">{l}</li>)}
    </ul>
  );
}

/** How many recent periods the card strip shows. */
function stripLength(f: Pick<InboxForm, "frequency">) {
  return f.frequency === "daily" ? 14 : f.frequency === "weekly" ? 8 : 1;
}

/** The office's recent periods for each form: drives the strips, the "due" hero and the attention list. */
function useRecent(forms: InboxForm[], office: string, today: string) {
  return useQueries({
    queries: forms.map((f) => {
      const last = f.end_date && f.end_date < today ? f.end_date : today;
      const end = periodOf(f, last);
      const start = f.frequency === "once" ? f.start_date
        : [addDays(end, -(stripLength(f) - 1) * stepOf(f)), f.start_date].sort().at(-1)!;
      return {
        queryKey: ["form-periods", f.id, office, start, end],
        enabled: !!office && !!today && f.start_date <= today,
        queryFn: () => api.get<PeriodsResponse>(`/api/forms/${f.id}/periods${qs({ office, start, end })}`),
        staleTime: 30_000,
      };
    }),
  });
}

const fillTo = (formId: number, office: string, ps: string) => `/forms/${formId}/fill${qs({ office, period: ps })}`;

/** Now, ticking every minute (deadlines turn overdue while the page is open). */
function useNow() {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id); }, []);
  return now;
}

type Row = { form: InboxForm; p: Submission };

/** A district office's forms with their recent periods, sorted into returned / overdue / due rows. */
function useOfficeForms(enabled = true) {
  const me = useUser();
  const today = useToday();
  const office = me.office?.code ?? "";
  const inbox = useInbox(enabled);
  const forms = React.useMemo(() => (inbox.data ?? []).filter((f) => f.offices.includes(office) || !office), [inbox.data, office]);
  const recent = useRecent(enabled ? forms : [], office, today);
  const now = useNow();
  const rows: Row[] = forms.flatMap((f, i) => (recent[i]?.data?.periods ?? []).map((p) => ({ form: f, p })));
  const writable = (r: Row) => !r.p.read_only_reason && r.form.status === "published";
  const returned = rows.filter((r) => r.p.status === "returned").sort((a, b) => b.p.period_start.localeCompare(a.p.period_start));
  const overdue = rows.filter((r) => writable(r) && isOverdue(r.p.status, r.p.deadline, now)).sort((a, b) => a.p.period_start.localeCompare(b.p.period_start));
  const due = rows.filter((r) => writable(r) && (r.p.status === "none" || r.p.status === "draft") && !isOverdue(r.p.status, r.p.deadline, now))
    .sort((a, b) => (a.p.deadline ?? "9").localeCompare(b.p.deadline ?? "9"));
  return { inbox, office, today, forms, recent, now, returned, overdue, due };
}

/** Header bell for district offices: returned + overdue periods, listed in a modal. */
export function AttentionBell() {
  const me = useUser();
  const { t, tf, lang } = useT();
  const [open, setOpen] = React.useState(false);
  const { office, forms, returned, overdue } = useOfficeForms(me.role === "district");
  if (me.role !== "district") return null;
  const n = returned.length + overdue.length;
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`${t("needs_attention")}${n ? ` · ${n}` : ""}`} title={t("needs_attention")}
        className="relative flex size-9 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-current hover:bg-r-sunk">
        <Bell className="size-5" aria-hidden />
        {n > 0 && (
          <span className="num absolute -top-0.5 -right-0.5 min-w-[18px] rounded-full bg-r-overdue px-1 text-center text-[11px] leading-[18px] font-bold text-white">{n}</span>
        )}
      </button>
      <RSheet open={open} onClose={close} closeLabel={t("close")} title={t("needs_attention")} description={n ? undefined : t("caught_up_sub")}>
        {!n ? (
          <div className="flex items-center gap-3 rounded-[14px] bg-r-card p-4">
            <CheckCircle2 className="size-6 shrink-0 text-r-accepted" aria-hidden />
            <b>{t("caught_up")}</b>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {returned.map(({ form, p }) => (
              <Link key={`r${form.id}${p.period_start}`} to={fillTo(form.id, office, p.period_start)} onClick={close}
                className="flex gap-3.5 rounded-[14px] border-[1.5px] border-r-returned bg-r-returned-soft p-4 text-r-ink no-underline">
                <StatusMark mark="ret" className="mt-1" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <b>{tf("returned_to_you", { day: dayMonth(p.period_start, lang) })}</b>
                  {forms.length > 1 && <span className="text-sm text-r-returned-ink">{formTitle(form, lang)}</span>}
                  {p.review_note && <span className="text-[15px] text-r-returned-ink">“{p.review_note}”</span>}
                  {p.reviewed_at && <span className="text-[13px] text-r-returned-ink">{p.reviewed_by || t("state_office")} · {whenText(p.reviewed_at, lang)}</span>}
                </div>
                <ChevronRight className="mt-0.5 size-5 shrink-0 text-r-returned-ink" aria-hidden />
              </Link>
            ))}
            {overdue.map(({ form, p }) => (
              <Link key={`o${form.id}${p.period_start}`} to={fillTo(form.id, office, p.period_start)} onClick={close}
                className="flex gap-3.5 rounded-[14px] border-[1.5px] border-r-overdue bg-r-card p-4 text-r-ink no-underline">
                <StatusMark mark="over" className="mt-1" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <b>{tf("is_overdue", { day: periodLabel(form, p.period_start, lang) })}</b>
                  {forms.length > 1 && <span className="text-sm text-r-muted">{formTitle(form, lang)}</span>}
                  {p.deadline && <span className="text-[15px] text-r-muted">{tf("was_due", { when: whenText(p.deadline, lang) })}</span>}
                </div>
                <ChevronRight className="mt-0.5 size-5 shrink-0 text-r-muted" aria-hidden />
              </Link>
            ))}
          </div>
        )}
      </RSheet>
    </>
  );
}

export default function MyFormsPage() {
  const me = useUser();
  const [params] = useSearchParams();
  if (me.role !== "district") return <FormsOverview />;
  return <DistrictToday listOnly={params.get("view") === "forms"} />;
}

// --------------------------------------------------------------------------- district: Today
function DistrictToday({ listOnly }: { listOnly: boolean }) {
  const me = useUser();
  const { t, tf, shortName, lang } = useT();
  const { data: meta } = useMeta();
  const { inbox: { error, isLoading }, office, today, forms, recent } = useOfficeForms();
  const division = meta?.divisions.find((d) => d.offices.some((o) => o.code === office));

  // search + All / Edited by state / Returned over the form list
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<MineFilter>("all");
  const ps = (i: number) => recent[i]?.data?.periods ?? [];
  const inFilter = (i: number, k: MineFilter) => k === "all"
    || (k === "edited" ? ps(i).some((p) => Object.keys(p.corrections).length > 0) : ps(i).some((p) => p.status === "returned") || forms[i].returned > 0);
  const counts = Object.fromEntries(FILTERS.map((k) => [k, forms.filter((_, i) => inFilter(i, k)).length])) as Record<MineFilter, number>;
  const needle = q.trim().toLocaleLowerCase();
  const shown = forms.map((f, i) => ({ f, i })).filter(({ f, i }) => inFilter(i, filter)
    && (!needle || [f.title_mr, f.title_en].some((s) => s.toLocaleLowerCase().includes(needle))));

  return (
    <RPage>
      <RTitle eyebrow={today ? longDay(today, lang) : undefined}
        title={<>{t("district_officer")}: {shortName(me.office) || me.display_name}</>}
        sub={division?.label_mr} />

      {error ? <RError error={error} /> : isLoading ? <SkeletonCards /> : !forms.length ? (
        <RCard className="items-center py-10 text-center">
          <ClipboardList className="size-10 text-r-faint" aria-hidden />
          <h2 className="disp m-0 text-[22px] font-bold">{t("no_forms_office")}</h2>
          <p className="m-0 text-r-muted">{t("no_forms_office_sub")}</p>
        </RCard>
      ) : (
        <>
          <section className="flex flex-col gap-2" aria-labelledby="mine">
            <h2 id="mine" className={cn("mx-1 mt-1 mb-0 text-[15px] font-bold text-r-muted", listOnly && "sr-only")}>{t("nav_my_forms")}</h2>
            <RSearch value={q} onChange={setQ} placeholder={t("mine_search")} />
            <div role="group" aria-label={t("nav_my_forms")} className="flex flex-wrap gap-2">
              {FILTERS.map((k) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                  className={cn("inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-4 text-sm font-bold",
                    filter === k ? "border-r-ink bg-r-ink text-r-card" : "border-r-line bg-r-card text-r-ink hover:bg-r-sunk")}>
                  {t(`mine_${k}`)}
                  <span className={cn("num min-w-6 rounded-full px-1.5 py-px text-center text-xs", filter === k ? "bg-r-card text-r-ink" : "bg-r-sunk text-r-muted")}>{counts[k]}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 grid gap-5 lg:grid-cols-2">
              {shown.map(({ f, i }) => <FormCard key={f.id} form={f} periods={recent[i]?.data?.periods} office={office} />)}
            </div>
            {!shown.length && (
              <p className="m-0 rounded-[14px] bg-r-card p-4 text-r-muted">{needle ? tf("resp_no_match", { q: q.trim() }) : t("mine_none_in_filter")}</p>
            )}
          </section>
        </>
      )}
    </RPage>
  );
}

const FILTERS = ["all", "edited", "rejected"] as const;
type MineFilter = (typeof FILTERS)[number];

function periodLabel(form: Pick<InboxForm, "frequency">, ps: string, lang: string) {
  return form.frequency === "weekly" ? rangeText(ps, addDays(ps, 6), lang) : dayMonth(ps, lang);
}

function FormCard({ form, periods, office }: { form: InboxForm; periods?: Submission[]; office: string }) {
  const { t, tf, lang } = useT();
  const ps = periods ?? [];
  const sent = ps.filter((p) => ["submitted", "returned"].includes(p.status)).length;
  // always opens on today; missed and returned days are reached from their own rows or the day strip
  const to = fillTo(form.id, office, "");
  const freq = t(`freq_${form.frequency}` as TKey);
  // input needed: a returned period, or an open period not yet sent (falls back to the inbox count while periods load)
  const needsInput = periods
    ? form.status === "published" && ps.some((p) => !p.read_only_reason && ["none", "draft", "returned"].includes(p.status))
    : form.to_fill > 0;

  const p = ps.at(-1);
  const paused = form.status === "paused";
  const period = form.frequency === "weekly" && p ? rangeText(p.period_start, p.period_end, lang)
    : form.frequency === "daily" && p && ps.length > 1 ? rangeText(form.start_date, form.end_date ?? p.period_start, lang)
    : p ? dayMonth(p.period_start, lang)
    : rangeText(form.start_date, form.end_date ?? form.start_date, lang);
  const open = p && (p.status === "none" || p.status === "draft");
  const pct = ps.length ? Math.round((sent / ps.length) * 100) : 0;
  return (
    <Link to={to} className="group flex min-w-0 flex-col gap-5 rounded-2xl border border-r-line bg-r-card p-6 shadow-[0_1px_2px_rgb(21_32_43/0.06),0_4px_12px_rgb(21_32_43/0.06)] text-r-ink no-underline transition-colors hover:border-r-field">
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs font-bold tracking-[0.06em] text-r-muted uppercase">{freq}</span>
          <h3 className="m-0 text-[17px] leading-snug font-bold">{formTitle(form, lang)}</h3>
        </div>
        <span className={cn("shrink-0 rounded-full px-3 py-1 text-[13px] font-bold",
          paused ? "bg-r-sunk text-r-muted" : needsInput ? "bg-r-accepted text-r-card" : "bg-r-accepted-soft text-r-accepted")}>
          {paused ? t("status_paused") : t(needsInput ? "chip_fill" : "chip_completed")}
        </span>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-r-line-soft pt-4 sm:grid-cols-3">
        <Fact label={t("period")}>{period}</Fact>
        <Fact label={t("status")}>{p ? t(`sub_${p.status}` as TKey) : "—"}</Fact>
        <Fact label={t("deadline")}>{open && p.deadline && !paused ? whenText(p.deadline, lang) : "—"}</Fact>
      </dl>
      {ps.length > 1 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-bold text-r-muted">{t("progress")}</span>
            <span className="num text-r-muted">{tf("days_sent_of", { a: sent, b: ps.length })}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-r-sunk" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-r-accepted" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      <span className="flex items-center gap-1 self-end text-sm font-bold text-r-action group-hover:underline">
        {t(needsInput && !paused ? "fill_now" : "view")} <ChevronRight className="size-4" aria-hidden />
      </span>
    </Link>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs font-bold tracking-[0.04em] text-r-muted uppercase">{label}</dt>
      <dd className="m-0 truncate text-[15px] font-semibold">{children}</dd>
    </div>
  );
}

function SkeletonCards() {
  return (
    <div className="grid gap-5 lg:grid-cols-2" aria-busy>
      {[0, 1].map((i) => <div key={i} className="h-48 animate-pulse rounded-2xl bg-r-sunk" />)}
    </div>
  );
}

// --------------------------------------------------------------------------- zone / state: forms they can open
function FormsOverview() {
  const { t, lang } = useT();
  const { data, error, isLoading } = useInbox();
  return (
    <RPage>
      <RTitle title={t("my_forms_title")} />
      {error ? <RError error={error} /> : isLoading || !data ? <SkeletonCards /> : !data.length ? (
        <RCard className="items-center py-10 text-center"><b>{t("no_forms")}</b></RCard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((f) => (
            <section key={f.id} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-r-line bg-r-card p-5 shadow-[0_1px_2px_rgb(21_32_43/0.06),0_4px_12px_rgb(21_32_43/0.06)]">
              <div className="flex items-start gap-4">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs font-bold tracking-[0.06em] text-r-muted uppercase">{t(`freq_${f.frequency}` as TKey)}</span>
                  <h3 className="m-0 text-[17px] leading-snug font-bold">{formTitle(f, lang)}</h3>
                </div>
                {f.status === "paused" && <span className="shrink-0 rounded-full bg-r-sunk px-3 py-1 text-[13px] font-bold text-r-muted">{t("status_paused")}</span>}
              </div>
              <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-r-line-soft pt-4 sm:grid-cols-3">
                <Fact label={t("period")}>{rangeText(f.start_date, f.end_date ?? f.latest_period ?? f.start_date, lang)}</Fact>
                <Fact label={t("deadline")}>{f.latest_deadline && f.status === "published" ? whenText(f.latest_deadline, lang) : "—"}</Fact>
                <Fact label={t("offices_n")}><span className="num">{f.offices.length}</span></Fact>
              </dl>
              <div className="grid grid-cols-3 gap-2">
                {([["pend", "pending", f.pending], ["over", "overdue", f.overdue], ["ret", "returned_n", f.returned]] as const).map(([mark, label, n]) => (
                  <div key={mark} className="flex flex-col gap-1.5 rounded-xl bg-r-sunk px-3 py-2.5">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-r-muted"><StatusMark mark={mark} /> {t(label)}</span>
                    <b className={cn("num text-xl leading-none", !n && "text-r-faint")}>{n}</b>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </RPage>
  );
}
