import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";
import { addDays, cn, dmy } from "@/lib/utils";
import { RInput } from "@/components/reports/kit";
import { Input } from "@/components/ui/primitives";

const loc = (lang: string) => (lang === "mr" ? "mr-IN" : "en-IN");
const utc = (iso: string) => new Date(iso + "T00:00:00Z");
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar day in IST, as "YYYY-MM-DD". */
export const todayIst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** "16/10/2026" (also 16-10-2026, 16.10.2026, 1/2/2026) → "2026-10-16"; null when it isn't a real day. */
export function parseDmy(s: string) {
  const m = s.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isoOf(utc(iso)) === iso ? iso : null;
}

/** Six weeks of one month (Monday first). Days before `min` or after `max` can't be picked. */
export function MonthCalendar({ value, min = "", max = "", today, onPick }: {
  value: string; min?: string; max?: string; today: string; onPick: (d: string) => void;
}) {
  const { t, lang } = useT();
  const start = (ISO.test(value) ? value : today).slice(0, 7);
  const [month, setMonth] = React.useState(start);
  React.useEffect(() => { setMonth(start); }, [start]);

  const first = utc(month + "-01");
  const lead = (first.getUTCDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => addDays(isoOf(first), i - lead));
  const shift = (n: number) => { const d = utc(month + "-01"); d.setUTCMonth(d.getUTCMonth() + n); setMonth(isoOf(d).slice(0, 7)); };
  const ok = (d: string) => (!min || d >= min) && (!max || d <= max);
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => utc(d).toLocaleDateString(loc(lang), { timeZone: "UTC", ...o });
  const nav = "flex size-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-r-ink hover:bg-r-sunk disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className={nav} aria-label={t("earlier")} disabled={!!min && month <= min.slice(0, 7)} onClick={() => shift(-1)}><ChevronLeft className="size-4" /></button>
        <b className="text-[15px]">{fmt(month + "-01", { month: "long", year: "numeric" })}</b>
        <button type="button" className={nav} aria-label={t("later")} disabled={!!max && month >= max.slice(0, 7)} onClick={() => shift(1)}><ChevronRight className="size-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {days.slice(0, 7).map((d) => <span key={d} className="py-1 text-[11px] font-bold text-r-faint uppercase">{fmt(d, { weekday: "narrow" })}</span>)}
        {days.map((d) => {
          const inMonth = d.slice(0, 7) === month;
          const sel = d === value;
          const isToday = d === today;
          return (
            <button key={d} type="button" disabled={!ok(d)} onClick={() => onPick(d)} aria-pressed={sel} aria-label={dmy(d)}
              className={cn("num relative flex h-9 cursor-pointer items-center justify-center rounded-lg border-0 text-sm disabled:cursor-not-allowed disabled:opacity-25",
                sel ? "bg-r-action font-bold text-white" : "bg-transparent hover:bg-r-sunk",
                !sel && (inMonth ? "text-r-ink" : "text-r-faint"),
                isToday && !sel && "font-bold text-r-action ring-1 ring-r-action ring-inset")}>
              {fmt(d, { day: "numeric" })}
            </button>
          );
        })}
      </div>
    </>
  );
}

type DateInputProps = {
  value: string; onChange: (iso: string) => void; min?: string; max?: string;
  id?: string; disabled?: boolean; required?: boolean; title?: string; className?: string;
  "aria-invalid"?: boolean | "true" | "false"; big?: boolean;
  /** `plain` matches the older shadcn-style pages; the default matches the reports kit. */
  look?: "report" | "plain";
};

/** A date field that always reads and types dd/mm/yyyy, whatever the browser's language. Hands back "YYYY-MM-DD", or "" when cleared. */
export function DateInput({ value, onChange, min, max, id, disabled, required, title, className, big, look = "report", ...rest }: DateInputProps) {
  const { t } = useT();
  const [text, setText] = React.useState(ISO.test(value) ? dmy(value) : "");
  const [open, setOpen] = React.useState(false);
  const [bad, setBad] = React.useState(false);
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { setText(ISO.test(value) ? dmy(value) : ""); setBad(false); }, [value]);
  React.useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const inRange = (d: string) => (!min || d >= min) && (!max || d <= max);
  const type = (raw: string) => {
    let v = raw.replace(/[^\d/.-]/g, "").replace(/[.-]/g, "/").slice(0, 10);
    // add the slash after dd and mm while typing forward, so "16102026" becomes "16/10/2026"
    if (v.length > text.length && /^(\d{2}|\d{2}\/\d{2})$/.test(v)) v += "/";
    setText(v);
    if (!v) { setBad(false); onChange(""); return; }
    const iso = parseDmy(v);
    setBad(!!iso && !inRange(iso));
    if (iso && inRange(iso) && iso !== value) onChange(iso);
  };
  const settle = () => {
    const iso = parseDmy(text);
    if (text && (!iso || !inRange(iso))) { setText(ISO.test(value) ? dmy(value) : ""); setBad(false); }
  };
  const pick = (d: string) => { onChange(d); setText(dmy(d)); setBad(false); setOpen(false); };

  const Field = look === "plain" ? Input : RInput;
  const invalid = bad || rest["aria-invalid"] === true || rest["aria-invalid"] === "true";
  return (
    <div ref={box} className={cn("relative", look === "plain" ? "w-40" : "w-44", className)}>
      <Field id={id} type="text" inputMode="numeric" autoComplete="off" placeholder="dd/mm/yyyy" maxLength={10}
        value={text} disabled={disabled} required={required} title={title} aria-invalid={invalid || undefined}
        {...(look === "report" && big ? { big: true } : {})}
        onChange={(e) => type(e.target.value)} onBlur={settle}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && e.altKey) { e.preventDefault(); setOpen(true); } }}
        className={cn("num w-full pr-10", big && "pr-12")} />
      <button type="button" disabled={disabled} aria-label={t("date")} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center border-0 bg-transparent text-r-muted hover:text-r-ink disabled:cursor-not-allowed disabled:opacity-40">
        <CalendarDays className="size-4" aria-hidden />
      </button>
      {open && (
        <div role="dialog" aria-label={t("date")} className="absolute top-full left-0 z-50 mt-2 w-[296px] rounded-2xl border border-r-line bg-r-card p-3 text-r-ink shadow-xl">
          <MonthCalendar value={value} min={min} max={max} today={todayIst()} onPick={pick} />
        </div>
      )}
    </div>
  );
}
