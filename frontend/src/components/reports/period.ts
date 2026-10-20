import type { FormDef, SubStatus } from "@/lib/api";
import { addDays } from "@/lib/utils";

type Sched = Pick<FormDef, "frequency" | "start_date" | "end_date"> & { deadline_hours?: number | null };

/** Days between two period starts. */
export function stepOf(form: Pick<FormDef, "frequency">) {
  return form.frequency === "weekly" ? 7 : 1;
}

/** period_start of the period containing day d (clamped to the form's schedule). */
export function periodOf(form: Sched, d: string) {
  if (form.frequency === "once" || d <= form.start_date) return form.start_date;
  const days = Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(form.start_date + "T00:00:00Z")) / 86_400_000);
  return addDays(form.start_date, Math.floor(days / stepOf(form)) * stepOf(form));
}

/** Mirrors app/forms/periods.py period_end. */
export function periodEnd(form: Sched, ps: string) {
  const end = form.frequency === "weekly" ? addDays(ps, 6) : form.frequency === "once" ? form.end_date || ps : ps;
  return form.end_date && form.frequency !== "once" && form.end_date < end ? form.end_date : end;
}

/** Mirrors app/forms/periods.py deadline: midnight IST after the period ends, plus deadline_hours. */
export function deadlineOf(form: Sched, ps: string): Date | null {
  if (form.deadline_hours === null || form.deadline_hours === undefined) return null;
  const midnightIst = Date.parse(addDays(periodEnd(form, ps), 1) + "T00:00:00+05:30");
  return new Date(midnightIst + form.deadline_hours * 3_600_000);
}

/** Nothing sent (or only a draft) and the deadline has passed. */
export function isOverdue(status: SubStatus, deadline: Date | string | null | undefined, now = Date.now()) {
  if (status !== "none" && status !== "draft") return false;
  if (!deadline) return false;
  const t = typeof deadline === "string" ? Date.parse(deadline) : deadline.getTime();
  return t < now;
}

const loc = (lang: string) => (lang === "mr" ? "mr-IN" : "en-IN");

/** "Fri 16 Oct" / "शुक्र, १६ ऑक्टो" */
export function shortDay(iso: string, lang: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(loc(lang), { weekday: "short", day: "numeric", month: "short" });
}

/** "Friday 16 October" */
export function longDay(iso: string, lang: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(loc(lang), { weekday: "long", day: "numeric", month: "long" });
}

/** "18 October 2026" */
export function fullDay(iso: string, lang: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(loc(lang), { day: "numeric", month: "long", year: "numeric" });
}

/** "16 Oct" */
export function dayMonth(iso: string, lang: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(loc(lang), { day: "numeric", month: "short" });
}

/** "3 – 16 Oct" or "28 Sep – 4 Oct" */
export function rangeText(a: string, b: string, lang: string) {
  if (a === b) return dayMonth(a, lang);
  const da = new Date(a + "T00:00:00"), db = new Date(b + "T00:00:00");
  const left = da.getMonth() === db.getMonth()
    ? da.toLocaleDateString(loc(lang), { day: "numeric" }) : dayMonth(a, lang);
  return `${left} – ${dayMonth(b, lang)}`;
}

export function timeOf(d: Date | string, lang: string) {
  return new Date(d).toLocaleTimeString(loc(lang), { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

/** "Thu 15 Oct, 11:20 am" in IST. */
export function whenText(d: Date | string, lang: string) {
  return new Date(d).toLocaleString(loc(lang), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

/** "3 h 20 min" until (or since) a moment. */
export function durationText(ms: number, lang: string) {
  const mins = Math.max(0, Math.round(Math.abs(ms) / 60_000));
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const n = (x: number) => x.toLocaleString(loc(lang));
  const u = lang === "mr" ? { d: "दि", h: "ता", m: "मि" } : { d: "d", h: "h", m: "min" };
  if (d) return `${n(d)} ${u.d} ${n(h)} ${u.h}`;
  if (h) return `${n(h)} ${u.h} ${n(m)} ${u.m}`;
  return `${n(m)} ${u.m}`;
}

/** Same calendar day in IST. */
export function sameIstDay(a: Date, b: Date) {
  const f = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return f(a) === f(b);
}

/** Figures always use Indian grouping (1,24,560) in Latin digits so columns line up in both languages. */
export function fig(n: number | null | undefined) {
  return n === null || n === undefined ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** "+11%" / "−6%" / "0%" / "—" against a previous value. */
export function deltaPct(now: number | undefined, prev: number | undefined) {
  if (now === undefined || prev === undefined) return { text: "—", dir: 0 as const };
  if (!prev) return now ? { text: "new", dir: 1 as const } : { text: "0%", dir: 0 as const };
  const p = Math.round((100 * (now - prev)) / prev);
  return { text: p > 0 ? `+${p}%` : p < 0 ? `−${Math.abs(p)}%` : "0%", dir: (p > 0 ? 1 : p < 0 ? -1 : 0) as 1 | -1 | 0 };
}
