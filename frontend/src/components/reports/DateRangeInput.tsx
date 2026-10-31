import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";
import { addDays, cn, dmy } from "@/lib/utils";
import { DateInput, todayIst } from "@/components/reports/DateInput";

const loc = (lang: string) => (lang === "mr" ? "mr-IN" : "en-IN");
const utc = (iso: string) => new Date(iso + "T00:00:00Z");
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const shiftMonth = (month: string, n: number) => { const d = utc(month + "-01"); d.setUTCMonth(d.getUTCMonth() + n); return isoOf(d).slice(0, 7); };
const daysBetween = (a: string, b: string) => Math.round((utc(b).getTime() - utc(a).getTime()) / 86400000) + 1;

export type DateRange = { start: string; end: string };
export type RangePreset = { label: string; start: string; end: string };

/** A from–to date range: the field shows "dd/mm/yyyy – dd/mm/yyyy"; the panel has presets, typed From / To
 * fields and two months (one on a phone). The first click on a day starts the range, the second ends it. */
export function DateRangeInput({ value, onChange, min = "", max = "", presets = [], id, className }: {
  value: DateRange; onChange: (r: DateRange) => void; min?: string; max?: string; presets?: RangePreset[];
  id?: string; className?: string;
}) {
  const { t, tf } = useT();
  const [open, setOpen] = React.useState(false);
  // the first day picked while the second is still to come
  const [anchor, setAnchor] = React.useState<string | null>(null);
  const [hover, setHover] = React.useState<string | null>(null);
  const [month, setMonth] = React.useState((value.end || todayIst()).slice(0, 7));
  const box = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    // show the range's last month on the right, so the whole of a short range is in view
    setMonth(shiftMonth((value.end || todayIst()).slice(0, 7), !value.start || value.start.slice(0, 7) === value.end.slice(0, 7) ? 0 : -1));
    setAnchor(null); setHover(null);
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (r: DateRange) => { onChange(r); setOpen(false); };
  const pick = (d: string) => {
    if (!anchor) { setAnchor(d); return; }
    apply(d < anchor ? { start: d, end: anchor } : { start: anchor, end: d });
  };
  // what the grid tints: the pending range while picking, else the current one
  const lo = anchor ? (hover && hover < anchor ? hover : anchor) : value.start;
  const hi = anchor ? (hover && hover > anchor ? hover : anchor) : value.end;
  const label = value.start && value.end ? (value.start === value.end ? dmy(value.start) : `${dmy(value.start)} – ${dmy(value.end)}`) : "—";
  const nav = "flex size-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-r-ink hover:bg-r-sunk disabled:cursor-not-allowed disabled:opacity-30";
  const prevOk = !min || month > min.slice(0, 7);
  const nextOk = !max || shiftMonth(month, 1) < max.slice(0, 7);

  return (
    <div ref={box} className={cn("relative", className)}>
      <button type="button" id={id} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="num flex min-h-[38px] cursor-pointer items-center gap-2.5 rounded-lg border-[1.5px] border-r-field bg-r-card px-3 text-left text-[15px] font-bold text-r-ink hover:border-r-ink aria-expanded:border-r-ink">
        <CalendarDays className="size-4 shrink-0 text-r-muted" aria-hidden />
        <span className="whitespace-nowrap">{label}</span>
        {value.start && value.end && <span className="text-[13px] font-normal text-r-muted">· {tf("rng_days", { n: daysBetween(value.start, value.end) })}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label={t("rng_label")}
          className="absolute top-full left-0 z-50 mt-2 flex w-[min(calc(100vw-2rem),340px)] flex-col gap-4 rounded-2xl border border-r-line bg-r-card p-4 text-r-ink shadow-xl sm:w-auto sm:flex-row">
          {presets.length > 0 && (
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0 sm:w-44 sm:flex-col sm:flex-nowrap sm:border-r sm:border-r-line-soft sm:pr-4">
              {presets.map((p) => {
                const on = !anchor && p.start === value.start && p.end === value.end;
                return (
                  <li key={p.label}>
                    <button type="button" aria-pressed={on} onClick={() => apply({ start: p.start, end: p.end })}
                      className={cn("w-full cursor-pointer rounded-lg border-0 px-3 py-2 text-left text-sm font-bold",
                        on ? "bg-r-action-soft text-r-action" : "bg-r-sunk text-r-ink hover:bg-r-line sm:bg-transparent sm:hover:bg-r-sunk")}>
                      {p.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[13px] font-bold text-r-muted">{t("from")}</span>
                <DateInput className="w-40" value={value.start} min={min} max={value.end || max}
                  onChange={(d) => d && onChange({ start: d, end: value.end })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[13px] font-bold text-r-muted">{t("to")}</span>
                <DateInput className="w-40" value={value.end} min={value.start || min} max={max}
                  onChange={(d) => d && onChange({ start: value.start, end: d })} />
              </label>
            </div>
            <div className="flex items-center justify-between">
              <button type="button" className={nav} aria-label={t("earlier")} disabled={!prevOk} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft className="size-4" /></button>
              <span className="text-[13px] font-bold text-r-action" aria-live="polite">{anchor ? t("rng_pick_end") : t("rng_pick_start")}</span>
              <button type="button" className={nav} aria-label={t("later")} disabled={!nextOk} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight className="size-4" /></button>
            </div>
            <div className="flex gap-6" onMouseLeave={() => setHover(null)}>
              <RangeMonth month={month} lo={lo} hi={hi} min={min} max={max} onPick={pick} onHover={setHover} />
              <RangeMonth month={shiftMonth(month, 1)} lo={lo} hi={hi} min={min} max={max} onPick={pick} onHover={setHover} className="hidden sm:block" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One month (Monday first) with the days from `lo` to `hi` tinted and the two ends filled. */
function RangeMonth({ month, lo, hi, min, max, onPick, onHover, className }: {
  month: string; lo: string; hi: string; min: string; max: string; onPick: (d: string) => void; onHover: (d: string) => void; className?: string;
}) {
  const { lang } = useT();
  const today = todayIst();
  const first = utc(month + "-01");
  const lead = (first.getUTCDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => addDays(isoOf(first), i - lead));
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => utc(d).toLocaleDateString(loc(lang), { timeZone: "UTC", ...o });
  const ok = (d: string) => (!min || d >= min) && (!max || d <= max);
  return (
    <div className={cn("w-[266px]", className)}>
      <b className="mb-2 block text-center text-[15px]">{fmt(month + "-01", { month: "long", year: "numeric" })}</b>
      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {days.slice(0, 7).map((d) => <span key={d} className="py-1 text-[11px] font-bold text-r-faint uppercase">{fmt(d, { weekday: "narrow" })}</span>)}
        {days.map((d) => {
          // days of the next / previous month are left blank, so a range across two grids isn't drawn twice
          if (d.slice(0, 7) !== month) return <span key={d} aria-hidden />;
          const end = d === lo || d === hi;
          const inside = !!lo && !!hi && d > lo && d < hi;
          return (
            <span key={d} className={cn("flex h-9 items-center justify-center",
              (inside || (end && lo !== hi)) && "bg-r-action-soft", d === lo && lo !== hi && "rounded-l-lg", d === hi && lo !== hi && "rounded-r-lg")}>
              <button type="button" disabled={!ok(d)} onClick={() => onPick(d)} onMouseEnter={() => onHover(d)} aria-pressed={end} aria-label={dmy(d)}
                className={cn("num flex size-9 cursor-pointer items-center justify-center rounded-lg border-0 text-sm disabled:cursor-not-allowed disabled:opacity-25",
                  end ? "bg-r-action font-bold text-white" : "bg-transparent text-r-ink hover:bg-r-sunk",
                  d === today && !end && "font-bold text-r-action ring-1 ring-r-action ring-inset")}>
                {fmt(d, { day: "numeric" })}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
