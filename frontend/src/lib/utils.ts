import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Every date on the site reads dd/mm/yyyy (Latin digits in both languages). A "YYYY-MM-DD" day is taken as written; an instant is read in IST. */
export function dmy(d: string | Date) {
  if (typeof d === "string") {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return String(d);
  return x.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" });
}

/** Rewrites every "YYYY-MM-DD" inside a server string, e.g. "2026-10-19 11:42 IST" → "19/10/2026 11:42 IST". */
export function dmyText(s: string | null | undefined) {
  return (s ?? "").replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3/$2/$1");
}

export function fmtDate(iso: string) {
  return dmy(iso);
}

export function periodLabel(start: string, end: string) {
  return start === end ? fmtDate(start) : `${fmtDate(start)} → ${fmtDate(end)}`;
}

export function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function qs(params: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
