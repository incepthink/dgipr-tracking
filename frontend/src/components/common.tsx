import * as React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Inbox, Info, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLATFORM_LABEL } from "@/lib/status";
import { Card, Field, Input, Select, Skeleton } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useMeta } from "@/lib/hooks";
import { addDays } from "@/lib/utils";

export function PageHeader({
  title, description, step, actions, children,
}: { title: React.ReactNode; description?: React.ReactNode; step?: number; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 animate-rise">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {step && (
            <div className="mb-1.5 text-xs font-semibold tracking-wider text-primary uppercase">Step {step} of 3</div>
          )}
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

const PLATFORM_STYLE: Record<string, { bg: string; glyph: string }> = {
  facebook: { bg: "bg-[#1877F2]", glyph: "f" },
  instagram: { bg: "bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF]", glyph: "IG" },
  x: { bg: "bg-neutral-900 dark:bg-neutral-700", glyph: "𝕏" },
  youtube: { bg: "bg-[#FF0000]", glyph: "▶" },
};

export function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const s = PLATFORM_STYLE[platform] ?? { bg: "bg-muted-foreground", glyph: platform.slice(0, 1).toUpperCase() };
  return (
    <span
      title={PLATFORM_LABEL[platform] ?? platform}
      className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white", s.bg, className)}
    >
      {s.glyph}
    </span>
  );
}

export function PlatformTag({ platform }: { platform: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium">
      <PlatformIcon platform={platform} className="size-5 text-[10px]" />
      {PLATFORM_LABEL[platform] ?? platform}
    </span>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, children, action }: { icon?: React.ElementType; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div>
        <div className="font-medium">{title}</div>
        {children && <div className="mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Callout({ tone = "info", title, children, className, icon }: {
  tone?: "info" | "warning" | "danger"; title?: React.ReactNode; children?: React.ReactNode; className?: string; icon?: React.ElementType;
}) {
  const Icon = icon ?? (tone === "info" ? Info : AlertTriangle);
  const cls = {
    info: "border-info/25 bg-info-soft/60 text-foreground [&_svg]:text-info",
    warning: "border-warning/30 bg-warning-soft/70 text-foreground [&_svg]:text-warning",
    danger: "border-danger/30 bg-danger-soft/70 text-foreground [&_svg]:text-danger",
  }[tone];
  return (
    <div className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={cn(title && "mt-0.5", "text-muted-foreground")}>{children}</div>}
      </div>
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon, tone, to }: {
  label: string; value: React.ReactNode; hint?: React.ReactNode; icon: React.ElementType;
  tone?: "default" | "warning" | "success" | "danger"; to?: string;
}) {
  const iconCls = {
    default: "bg-primary/10 text-primary",
    warning: "bg-warning-soft text-warning",
    success: "bg-success-soft text-success",
    danger: "bg-danger-soft text-danger",
  }[tone ?? "default"];
  const body = (
    <Card className={cn("p-5 transition-shadow", to && "hover:shadow-md")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-1.5 text-3xl font-semibold tracking-tight tabular">{value}</div>
        </div>
        <div className={cn("flex size-10 items-center justify-center rounded-lg", iconCls)}>
          <Icon className="size-5" />
        </div>
      </div>
      {hint && <div className="mt-3 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );
}

export function ErrorState({ error }: { error: Error }) {
  return <Callout tone="danger" title="Couldn't load this page">{error.message}</Callout>;
}

/** Optional type-to-filter campaign search; empty (0) means no campaign. Shows the selected campaign when idle. */
export function CampaignSearch({ value, onChange }: { value: number; onChange: (id: number | null) => void }) {
  const { data: meta } = useMeta();
  const [query, setQuery] = React.useState<string | null>(null);
  const [active, setActive] = React.useState(0);
  const campaigns = meta?.campaigns ?? [];
  const label = (c: (typeof campaigns)[number]) => `${c.title_mr}${c.title_en ? ` — ${c.title_en}` : ""}`;
  const selected = campaigns.find((c) => c.id === value);
  const open = query !== null;
  const q = (query ?? "").trim().toLowerCase();
  const matches = q ? campaigns.filter((c) => label(c).toLowerCase().includes(q)) : campaigns;

  const pick = (id: number) => { onChange(id); setQuery(null); };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        role="combobox" aria-expanded={open} className={cn("pl-8", selected && "pr-8")}
        value={open ? query : selected ? label(selected) : ""}
        placeholder="Search (optional)"
        onFocus={() => { setQuery(""); setActive(0); }}
        onBlur={() => setQuery(null)}
        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && matches[active]) { e.preventDefault(); pick(matches[active].id); e.currentTarget.blur(); }
          else if (e.key === "Escape") e.currentTarget.blur();
        }}
      />
      {selected && !open && (
        <button type="button" aria-label="Clear search" onClick={() => onChange(null)}
          className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      )}
      {open && (
        <ul role="listbox" className="absolute z-50 mt-1 max-h-64 w-full min-w-72 overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md scrollbar-thin">
          {matches.length ? matches.map((c, i) => (
            <li key={c.id} role="option" aria-selected={c.id === value}
              onMouseDown={(e) => { e.preventDefault(); pick(c.id); (document.activeElement as HTMLElement | null)?.blur(); }}
              onMouseEnter={() => setActive(i)}
              className={cn("cursor-pointer rounded px-2 py-1.5", i === active && "bg-accent", c.id === value && "font-medium text-primary")}>
              {label(c)}
            </li>
          )) : <li className="px-2 py-1.5 text-muted-foreground">No matching campaigns</li>}
        </ul>
      )}
    </div>
  );
}

/** Campaign + reporting period selector with quick presets. */
export function PeriodPicker({
  campaignId, start, end, onChange, extra, searchableCampaign, lockPeriod,
}: {
  campaignId: number; start: string; end: string;
  onChange: (p: { campaign_id?: number | null; start?: string; end?: string }) => void; extra?: React.ReactNode;
  searchableCampaign?: boolean;
  /** Period was fixed in the Collect step — show it read-only. */
  lockPeriod?: boolean;
}) {
  const { data: meta } = useMeta();
  const yesterday = meta?.default_day ?? start;
  const presets = !yesterday ? [] : [
    { label: "Yesterday", s: yesterday, e: yesterday },
    { label: "Today", s: addDays(yesterday, 1), e: addDays(yesterday, 1) },
    { label: "Last 7 days", s: addDays(yesterday, -6), e: yesterday },
  ];
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={searchableCampaign ? "Search term" : "Campaign"} className={cn("min-w-56 flex-1 sm:flex-none", searchableCampaign && "sm:min-w-80")}>
          {searchableCampaign ? (
            <CampaignSearch value={campaignId} onChange={(id) => onChange({ campaign_id: id })} />
          ) : (
            <Select value={campaignId || ""} onChange={(e) => onChange({ campaign_id: Number(e.target.value) })}>
              {meta?.campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.title_mr}{c.title_en ? ` — ${c.title_en}` : ""}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="From (IST)">
          <Input type="date" value={start} max={end || undefined} disabled={lockPeriod}
            title={lockPeriod ? "Period is set in the Collect step" : undefined}
            onChange={(e) => e.target.value && onChange({ start: e.target.value, end: e.target.value > end ? e.target.value : end })} />
        </Field>
        <Field label="To (IST)">
          <Input type="date" value={end} min={start || undefined} disabled={lockPeriod}
            title={lockPeriod ? "Period is set in the Collect step" : undefined} onChange={(e) => e.target.value && onChange({ end: e.target.value })} />
        </Field>
        {!lockPeriod && <div className="flex flex-wrap gap-1.5 pb-0.5">
          {presets.map((p) => {
            const active = p.s === start && p.e === end;
            return (
              <Button key={p.label} size="sm" variant={active ? "secondary" : "ghost"} className={cn(active && "ring-1 ring-primary/30")}
                onClick={() => onChange({ start: p.s, end: p.e })}>
                {p.label}
              </Button>
            );
          })}
        </div>}
        {extra && <div className="ml-auto flex flex-wrap items-end gap-3">{extra}</div>}
      </div>
    </Card>
  );
}

export function OfficeSelect({ value, onChange, placeholder = "— Not mapped —", className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  const { data: meta } = useMeta();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{placeholder}</option>
      {meta?.divisions.map((d) => (
        <optgroup key={d.code} label={d.label_mr}>
          {d.offices.map((o) => <option key={o.code} value={o.code}>{o.name_mr}{o.name_en ? ` (${o.name_en})` : ""}</option>)}
        </optgroup>
      ))}
    </Select>
  );
}

export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre className={cn("max-h-[480px] overflow-auto rounded-lg bg-[oklch(0.18_0.02_260)] p-4 font-mono text-xs leading-relaxed text-[oklch(0.9_0.01_260)] scrollbar-thin", className)}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
