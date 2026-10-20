import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowRight, Bell, CheckCircle2, ChevronRight, ClipboardList } from "lucide-react";
import { api, type InboxForm, type PeriodsResponse, type Submission } from "@/lib/api";
import { useMeta } from "@/lib/hooks";
import { useUser } from "@/lib/auth";
import { useT, type TKey } from "@/lib/i18n";
import { addDays, cn, qs } from "@/lib/utils";
import { RButton, RCard, RError, RPage, RSearch, RSheet, RTitle, StatusMark } from "@/components/reports/kit";
import {
  dayMonth, durationText, isOverdue, longDay, periodOf, rangeText, sameIstDay, stepOf, timeOf, whenText,
} from "@/components/reports/period";
import { formTitle, useToday } from "./common";

export function useInbox(enabled = true) {
  return useQuery({ queryKey: ["forms-mine"], enabled, queryFn: () => api.get<InboxForm[]>("/api/forms/mine"), staleTime: 30_000 });
}

/** Pending + returned periods across a district office's forms (sidebar badge). */
export function useInboxCount() {
  const me = useUser();
  const { data } = useInbox(me.role === "district");
  return (data ?? []).reduce((n, f) => n + f.pending, 0);
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
  const { t, tf, name, lang } = useT();
  const { data: meta } = useMeta();
  const { inbox: { error, isLoading }, office, today, forms, recent, now, due } = useOfficeForms();
  const division = meta?.divisions.find((d) => d.offices.some((o) => o.code === office));
  const hero = due[0];

  // search + All / Accepted / Rejected over the form list
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<MineFilter>("all");
  const has = (i: number, st: string) => (recent[i]?.data?.periods ?? []).some((p) => p.status === st) || (st === "returned" && forms[i].returned > 0);
  const inFilter = (i: number, k: MineFilter) => k === "all" || has(i, k === "accepted" ? "accepted" : "returned");
  const counts = Object.fromEntries(FILTERS.map((k) => [k, forms.filter((_, i) => inFilter(i, k)).length])) as Record<MineFilter, number>;
  const needle = q.trim().toLocaleLowerCase();
  const shown = forms.map((f, i) => ({ f, i })).filter(({ f, i }) => inFilter(i, filter)
    && (!needle || [f.title_mr, f.title_en].some((s) => s.toLocaleLowerCase().includes(needle))));

  return (
    <RPage className="mx-auto w-full max-w-[1040px] gap-4">
      <header className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] font-bold tracking-[0.06em] text-r-muted uppercase">{today ? longDay(today, lang) : ""}</span>
        <h1 className="disp m-0 text-[28px] leading-[1.1] font-bold">{t("district_officer")}: {name(me.office) || me.display_name}</h1>
        {division && <span className="text-sm text-r-muted">{division.label_mr}</span>}
      </header>

      {error ? <RError error={error} /> : isLoading ? <SkeletonCards /> : !forms.length ? (
        <RCard className="items-center py-10 text-center">
          <ClipboardList className="size-10 text-r-faint" aria-hidden />
          <h2 className="disp m-0 text-[22px] font-bold">{t("no_forms_office")}</h2>
          <p className="m-0 text-r-muted">{t("no_forms_office_sub")}</p>
        </RCard>
      ) : (
        <>
          {!listOnly && (hero ? <DueHero form={hero.form} p={hero.p} office={office} now={now} /> : <CaughtUp />)}

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
            {shown.map(({ f, i }) => <FormCard key={f.id} form={f} periods={recent[i]?.data?.periods} office={office} />)}
            {!shown.length && (
              <p className="m-0 rounded-[14px] bg-r-card p-4 text-r-muted">{needle ? tf("resp_no_match", { q: q.trim() }) : t("mine_none_in_filter")}</p>
            )}
          </section>
        </>
      )}
    </RPage>
  );
}

const FILTERS = ["all", "accepted", "rejected"] as const;
type MineFilter = (typeof FILTERS)[number];

function periodLabel(form: Pick<InboxForm, "frequency">, ps: string, lang: string) {
  return form.frequency === "weekly" ? rangeText(ps, addDays(ps, 6), lang) : dayMonth(ps, lang);
}

function DueHero({ form, p, office, now }: { form: InboxForm; p: Submission; office: string; now: number }) {
  const { t, tf, lang } = useT();
  const dl = p.deadline ? new Date(p.deadline) : null;
  const dueLine = !dl ? null : sameIstDay(dl, new Date(now)) ? tf("due_today_by", { time: timeOf(dl, lang) }) : tf("due_by", { when: whenText(dl, lang) });
  const label = periodLabel(form, p.period_start, lang);
  return (
    <section className="flex flex-col gap-3.5 rounded-[18px] bg-r-nav p-5 text-white">
      {dueLine && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold text-r-focus">{dueLine}</span>
          {dl && <span className="num text-sm text-r-nav-text">{tf("time_left", { d: durationText(dl.getTime() - now, lang) })}</span>}
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        <span className="disp text-2xl leading-[1.15] font-bold">{formTitle(form, lang)}</span>
        <span className="text-r-nav-text">
          {tf("figures_for", { day: form.frequency === "weekly" ? rangeText(p.period_start, p.period_end, lang) : longDay(p.period_start, lang) })}
          {p.status === "draft" && <> · {t("sub_draft")}</>}
        </span>
      </div>
      <RButton asChild size="lg" className="border-white bg-white text-[#15202b] hover:bg-white/90">
        <Link to={fillTo(form.id, office, p.period_start)}>{tf("fill_in", { day: label })} <ArrowRight className="size-5" aria-hidden /></Link>
      </RButton>
    </section>
  );
}

function CaughtUp() {
  const { t } = useT();
  return (
    <section className="flex items-start gap-3.5 rounded-[18px] bg-r-nav p-5 text-white">
      <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-r-focus" aria-hidden />
      <div className="flex flex-col gap-1">
        <span className="disp text-2xl leading-[1.15] font-bold">{t("caught_up")}</span>
        <span className="text-r-nav-text">{t("caught_up_sub")}</span>
      </div>
    </section>
  );
}

function FormCard({ form, periods, office }: { form: InboxForm; periods?: Submission[]; office: string }) {
  const { t, tf, lang } = useT();
  const ps = periods ?? [];
  const sent = ps.filter((p) => ["submitted", "accepted", "returned"].includes(p.status)).length;
  const target = ps.find((p) => p.status === "returned") ?? ps.find((p) => p.status === "none" || p.status === "draft") ?? ps.at(-1);
  const to = fillTo(form.id, office, target?.period_start ?? form.first_pending ?? form.latest_period ?? "");
  const freq = t(`freq_${form.frequency}` as TKey);

  const p = ps.at(-1);
  const sub = form.status === "closed" ? t("status_closed")
    : form.frequency === "daily" && ps.length > 1 ? `${freq} · ${rangeText(form.start_date, form.end_date ?? p!.period_start, lang)} · ${tf("days_sent_of", { a: sent, b: ps.length })}`
    : p ? `${form.frequency === "weekly" ? tf("week_of", { range: rangeText(p.period_start, p.period_end, lang) }) : freq} · ${t(`sub_${p.status}` as TKey)}${p.deadline && (p.status === "none" || p.status === "draft") ? ` · ${tf("due_by", { when: whenText(p.deadline, lang) })}` : ""}`
    : freq;
  return (
    <Link to={to} className="flex items-center gap-3.5 rounded-[14px] bg-r-card p-4 text-r-ink no-underline hover:outline-2 hover:outline-r-line">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b>{formTitle(form, lang)}</b>
        <span className="text-sm text-r-muted">{sub}</span>
      </div>
      <ChevronRight className="size-5 shrink-0 text-r-faint" aria-hidden />
    </Link>
  );
}

function SkeletonCards() {
  return (
    <div className="flex flex-col gap-3" aria-busy>
      <div className="h-44 animate-pulse rounded-[18px] bg-r-sunk" />
      <div className="h-24 animate-pulse rounded-[14px] bg-r-sunk" />
      <div className="h-24 animate-pulse rounded-[14px] bg-r-sunk" />
    </div>
  );
}

// --------------------------------------------------------------------------- zone / state: forms they can open
function FormsOverview() {
  const { t, tf, lang } = useT();
  const { data, error, isLoading } = useInbox();
  return (
    <RPage>
      <RTitle title={t("my_forms_title")} sub={t("my_forms_desc")} />
      {error ? <RError error={error} /> : isLoading || !data ? <SkeletonCards /> : !data.length ? (
        <RCard className="items-center py-10 text-center"><b>{t("no_forms")}</b></RCard>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.map((f) => (
            <RCard key={f.id} className="gap-3">
              <div className="flex items-baseline justify-between gap-2">
                <b className="text-[17px]">{formTitle(f, lang)}</b>
                <span className="text-[13px] whitespace-nowrap text-r-muted">{t(`freq_${f.frequency}` as TKey)}</span>
              </div>
              <span className="text-sm text-r-muted">
                {rangeText(f.start_date, f.end_date ?? f.latest_period ?? f.start_date, lang)}
                {f.latest_deadline && f.status === "published" && <> · {tf("due_by", { when: whenText(f.latest_deadline, lang) })}</>}
              </span>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {f.pending > 0 && <span className="flex items-center gap-1.5"><StatusMark mark="pend" /> {t("pending")}: <b className="num">{f.pending}</b></span>}
                {f.overdue > 0 && <span className="flex items-center gap-1.5"><StatusMark mark="over" /> {t("overdue")}: <b className="num">{f.overdue}</b></span>}
                {f.returned > 0 && <span className="flex items-center gap-1.5"><StatusMark mark="ret" /> {t("returned_n")}: <b className="num">{f.returned}</b></span>}
                <RButton asChild size="sm" className="ml-auto">
                  <Link to={`/forms/responses?form=${f.id}`}>{t("nav_responses")} <ArrowRight aria-hidden /></Link>
                </RButton>
              </div>
            </RCard>
          ))}
        </div>
      )}
    </RPage>
  );
}
