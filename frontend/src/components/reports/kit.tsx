import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, CheckCircle2, Info, Loader2, Lock, Minus, Search, Undo2, WifiOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, type TKey } from "@/lib/i18n";
import { ApiError, type SubStatus } from "@/lib/api";

/* Building blocks for the Reports workspace design. Pages using these sit inside a `.rpt` wrapper
   (see RPage), which sets the design's ground, body face and marigold focus ring. */

// --------------------------------------------------------------------------- page
export function RPage({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rpt flex flex-col gap-5", className)} {...props} />;
}

export function RTitle({ title, sub, eyebrow, actions, className }: {
  title: React.ReactNode; sub?: React.ReactNode; eyebrow?: React.ReactNode; actions?: React.ReactNode; className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow && <div className="text-[13px] font-bold tracking-[0.06em] text-r-muted uppercase">{eyebrow}</div>}
        <h1 className="disp m-0 text-[32px] leading-[1.08] font-bold sm:text-[40px]">{title}</h1>
        {sub && <p className="m-0 max-w-[720px] text-r-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function RCard({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("flex min-w-0 flex-col gap-3.5 rounded-2xl bg-r-card p-5", className)} {...props} />;
}

export function RCardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 className={cn("m-0 text-lg font-bold", className)} {...props} />;
}

/** The white strip under the header that holds a page's filters. */
export function RFilterBar({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-end gap-x-5 gap-y-3 rounded-2xl bg-r-card px-5 py-3", className)} {...props} />;
}

// --------------------------------------------------------------------------- controls
const rButton = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap border-[1.5px] font-bold no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default: "border-r-ink bg-r-card text-r-ink hover:bg-r-sunk",
        pri: "border-r-action bg-r-action text-white hover:border-r-action-hover hover:bg-r-action-hover dark:text-r-ground",
        ghost: "border-transparent bg-transparent text-r-ink hover:bg-r-sunk",
        danger: "border-r-overdue bg-r-card text-r-overdue-ink hover:bg-r-overdue-soft",
      },
      size: {
        md: "min-h-11 rounded-[10px] px-[18px]",
        sm: "min-h-9 rounded-lg px-3 text-sm",
        lg: "min-h-[52px] rounded-xl px-[18px] text-base",
        icon: "size-9 rounded-lg p-0",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface RButtonProps extends React.ComponentProps<"button">, VariantProps<typeof rButton> {
  asChild?: boolean;
  loading?: boolean;
}

export function RButton({ className, variant, size, asChild, loading, disabled, children, type = "button", ...props }: RButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(rButton({ variant, size }), className)} disabled={disabled || loading} {...(asChild ? {} : { type })} {...props}>
      {asChild ? children : <>{loading && <Loader2 className="animate-spin" />}{children}</>}
    </Comp>
  );
}

export { rButton };

const fieldCls = "w-full border-[1.5px] border-r-field bg-r-card text-r-ink placeholder:text-r-faint aria-[invalid=true]:border-2 aria-[invalid=true]:border-r-overdue aria-[invalid=true]:bg-r-overdue-soft";

export function RInput({ className, big, ...props }: React.ComponentProps<"input"> & { big?: boolean }) {
  return <input className={cn(fieldCls, big ? "h-[54px] rounded-xl px-3.5 text-[17px]" : "min-h-[38px] rounded-lg px-2.5", className)} {...props} />;
}

export function RSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(fieldCls, "min-h-[38px] w-auto max-w-full cursor-pointer truncate rounded-lg px-2.5", className)} {...props}>{children}</select>;
}

export function RTextarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(fieldCls, "min-h-24 rounded-lg p-2.5", className)} {...props} />;
}

/** Label above a control. `small` is the 13 px filter-bar label; otherwise a bold body-size label. */
export function RLabel({ label, small, hint, error, htmlFor, className, children }: {
  label: React.ReactNode; small?: boolean; hint?: React.ReactNode; error?: React.ReactNode; htmlFor?: string;
  className?: string; children: React.ReactNode;
}) {
  const Wrap = htmlFor ? "div" : "label";
  return (
    <Wrap className={cn("flex min-w-0 max-w-full flex-col gap-1.5", small && "gap-1", className)}>
      {htmlFor ? <label htmlFor={htmlFor} className={small ? "text-[13px] font-bold text-r-muted" : "font-bold"}>{label}</label>
        : <span className={small ? "text-[13px] font-bold text-r-muted" : "font-bold"}>{label}</span>}
      {children}
      {hint && !error && <span className="text-sm text-r-muted">{hint}</span>}
      {error && (
        <span className="flex items-center gap-2 text-[15px] font-bold text-r-overdue-ink">
          <AlertCircle className="size-[18px] text-r-overdue" aria-hidden /> {error}
        </span>
      )}
    </Wrap>
  );
}

/** The square tick mark used by RCheck; `round` draws a radio dot instead. Visual only. */
export function RTick({ checked, mixed, round, className }: { checked: boolean; mixed?: boolean; round?: boolean; className?: string }) {
  const on = checked || mixed;
  return (
    <span aria-hidden className={cn("flex size-[18px] shrink-0 items-center justify-center border-[1.5px] transition-colors",
      round ? "rounded-full" : "rounded-[5px]",
      on ? (round ? "border-r-action bg-r-card" : "border-r-action bg-r-action text-white dark:text-r-ground") : "border-r-field bg-r-card", className)}>
      {round ? on && <span className="size-2 rounded-full bg-r-action" />
        : mixed ? <Minus className="size-3" strokeWidth={3.5} /> : checked && <Check className="size-3" strokeWidth={3.5} />}
    </span>
  );
}

/** Checkbox (or radio, with `radio`) as a button. Bordered toggle by default; `plain` drops the frame for lists and table cells. */
export function RCheck({ checked, onChange, mixed, radio, plain, className, children, ...props }:
  Omit<React.ComponentProps<"button">, "onChange"> & { checked: boolean; onChange: (v: boolean) => void; mixed?: boolean; radio?: boolean; plain?: boolean }) {
  return (
    <button type="button" role={radio ? "radio" : "checkbox"} aria-checked={mixed ? "mixed" : checked} onClick={() => onChange(radio ? true : !checked)}
      className={cn("inline-flex cursor-pointer items-center gap-2 text-left text-r-ink transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        plain ? "border-0 bg-transparent p-0 text-sm"
          : cn("min-h-9 rounded-lg border-[1.5px] px-3 text-sm font-bold", checked ? "border-r-action bg-r-action-soft" : "border-r-line bg-r-card hover:bg-r-sunk"),
        className)} {...props}>
      <RTick checked={checked} mixed={mixed} round={radio} />
      {children}
    </button>
  );
}

/** The big search bar on list pages; `children` sit after a divider at the right end (e.g. a date picker). */
export function RSearch({ value, onChange, placeholder, className, children }: {
  value: string; onChange: (v: string) => void; placeholder: string; className?: string; children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-h-16 items-center gap-3 rounded-2xl border-[1.5px] border-r-line bg-r-card py-2 pr-2 pl-5 focus-within:border-r-ink", className)}>
      <Search className="size-6 shrink-0 text-r-muted" aria-hidden />
      <input type="search" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 border-0 bg-transparent py-2 text-lg text-r-ink outline-none! placeholder:text-r-faint sm:text-xl [&::-webkit-search-cancel-button]:hidden" />
      {value && (
        <button type="button" aria-label="Clear" onClick={() => onChange("")}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-r-sunk text-r-muted hover:text-r-ink"><X className="size-4" /></button>
      )}
      {children && <><span className="h-8 w-px shrink-0 bg-r-line" aria-hidden />{children}</>}
    </div>
  );
}

/** Two to four mutually exclusive options in a sunk track. */
export function RSegmented<T extends string>({ value, onChange, options, label, className, full }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; label: string; className?: string; full?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex gap-[3px] rounded-[10px] bg-r-sunk p-[3px]", className)}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          className={cn("min-h-8 cursor-pointer rounded-lg border-0 px-3 text-sm font-bold", full && "flex-1",
            value === o.value ? "bg-r-card text-r-ink shadow-xs" : "bg-transparent text-r-muted hover:text-r-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function RChip({ className, tone = "plain", ...props }: React.ComponentProps<"span"> & { tone?: "plain" | "outline" | "ink" | "focus" }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[13px] font-bold",
      tone === "plain" && "bg-r-sunk text-r-ink",
      tone === "outline" && "border-[1.5px] border-r-ink bg-r-card text-r-ink",
      tone === "ink" && "bg-r-ink text-r-card",
      tone === "focus" && "bg-r-focus text-[#15202b]", className)} {...props} />
  );
}

const ALERT = {
  danger: { cls: "border-r-overdue bg-r-overdue-soft text-r-overdue-ink", icon: AlertCircle, ic: "text-r-overdue" },
  returned: { cls: "border-r-returned bg-r-returned-soft text-r-returned-ink", icon: Undo2, ic: "text-r-returned" },
  success: { cls: "border-r-accepted bg-r-accepted-soft text-r-ink", icon: CheckCircle2, ic: "text-r-accepted" },
  info: { cls: "border-r-line bg-r-card text-r-ink", icon: Info, ic: "text-r-action" },
} as const;

export function RAlert({ tone = "info", title, children, className, action }: {
  tone?: keyof typeof ALERT; title?: React.ReactNode; children?: React.ReactNode; className?: string; action?: React.ReactNode;
}) {
  const a = ALERT[tone];
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={cn("flex gap-3 rounded-xl border-[1.5px] p-3.5", a.cls, className)}>
      <a.icon className={cn("mt-px size-[22px] shrink-0", a.ic)} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title && <b className="text-r-ink">{title}</b>}
        {children && <div>{children}</div>}
        {action && <div className="mt-1">{action}</div>}
      </div>
    </div>
  );
}

/** A request that failed: plain words, the server's reason, and a retry that keeps every filter as it is. */
export function RError({ error }: { error: Error }) {
  const { t } = useT();
  const qc = useQueryClient();
  const denied = error instanceof ApiError && error.status === 403;
  return (
    <RCard className="items-start gap-2">
      {denied && <Lock className="size-7 text-r-muted" aria-hidden />}
      <b>{denied ? t("outside_scope") : t("didnt_load")}</b>
      <p className="m-0 text-r-muted">{error.message}{denied ? "" : ` · ${t("filters_kept")}`}</p>
      {!denied && <RButton size="sm" variant="pri" onClick={() => qc.refetchQueries({ type: "active" })}>{t("try_again")}</RButton>}
    </RCard>
  );
}

/** Shown across report pages while the browser is offline. */
export function OfflineBanner() {
  const { t } = useT();
  const [online, setOnline] = React.useState(() => navigator.onLine);
  React.useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="rpt mb-4 flex gap-3 rounded-xl bg-r-nav p-3.5 text-white">
      <WifiOff className="size-[22px] shrink-0 text-r-focus" aria-hidden />
      <div className="flex flex-col gap-1"><b>{t("offline_title")}</b><span className="text-[15px] text-r-nav-text">{t("offline_body")}</span></div>
    </div>
  );
}

// --------------------------------------------------------------------------- sheet
/** A bottom sheet on phones, a centred dialog from `sm` up. Body scrolls; `footer` stays pinned. */
export function RSheet({ open, onClose, title, description, footer, closeLabel, children, wide }: {
  open: boolean; onClose: () => void; title: React.ReactNode; description?: React.ReactNode; footer?: React.ReactNode;
  closeLabel: string; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#15202b]/55 data-[state=open]:animate-[fade-in_150ms]" />
        <DialogPrimitive.Content
          className={cn("rpt fixed z-50 flex flex-col overflow-hidden outline-none",
            "inset-x-0 bottom-0 max-h-[92vh] rounded-t-[22px]",
            "sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[88vh] sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[18px]",
            wide ? "sm:max-w-2xl" : "sm:max-w-lg")}>
          <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden><span className="h-[5px] w-11 rounded-[3px] bg-r-field" /></div>
          <header className="flex items-start justify-between gap-3 px-5 pt-3 pb-2 sm:pt-5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="disp m-0 text-[26px] leading-[1.15] font-bold">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-1 mb-0 text-[15px] text-r-muted">{description}</DialogPrimitive.Description>
                : <DialogPrimitive.Description className="sr-only">{closeLabel}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close aria-label={closeLabel}
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-r-card text-r-ink hover:bg-r-sunk">
              <X className="size-5" aria-hidden />
            </DialogPrimitive.Close>
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-4 pt-2 pb-4 sm:px-5">{children}</div>
          {footer && <footer className="flex flex-col gap-2.5 border-t border-r-line bg-r-card px-4 pt-3.5 pb-6 sm:px-5 sm:pb-5">{footer}</footer>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// --------------------------------------------------------------------------- status language
/** A period's status as drawn: the submission status, plus "overdue" / "pending" for nothing sent. */
export type Mark = "pend" | "draft" | "over" | "sub" | "acc" | "ret" | "na";

const MARK_LABEL: Record<Mark, TKey> = {
  pend: "st_pending", draft: "sub_draft", over: "overdue", sub: "sub_submitted", acc: "sub_accepted",
  ret: "sub_returned", na: "st_na",
};

/** Maps a submission status to its mark. Nothing sent (or only a draft) after the deadline is overdue. */
export function markOf(status: SubStatus, pastDeadline = false): Mark {
  if (status === "accepted") return "acc";
  if (status === "submitted") return "sub";
  if (status === "returned") return "ret";
  if (pastDeadline) return "over";
  return status === "draft" ? "draft" : "pend";
}

/** The shape-and-colour mark. Carries its word for screen readers; pass `label` to show it too. */
export function StatusMark({ mark, late, label, className, size }: {
  mark: Mark; late?: boolean; label?: boolean; className?: string; size?: number;
}) {
  const { t } = useT();
  const word = t(MARK_LABEL[mark]) + (late && mark !== "na" ? " · " + t("late") : "");
  const style = size ? { width: size, height: size } : undefined;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn("g", mark, late && mark !== "na" && mark !== "pend" && mark !== "over" && "late")} style={style}
        aria-hidden={label ? true : undefined} role={label ? undefined : "img"} aria-label={label ? undefined : word} />
      {label && <span>{word}</span>}
    </span>
  );
}

export function StatusLegend({ marks, className }: { marks: (Mark | "late")[]; className?: string }) {
  const { t } = useT();
  return (
    <div className={cn("flex flex-wrap gap-x-3.5 gap-y-1.5 text-[13px] text-r-muted", className)}>
      {marks.map((m) => (
        <span key={m} className="flex items-center gap-1.5">
          {m === "late" ? <span className="g sub late" aria-hidden /> : <span className={cn("g", m)} aria-hidden />}
          {m === "late" ? t("st_sent_late") : t(MARK_LABEL[m])}
        </span>
      ))}
    </div>
  );
}

/** A big figure tile: label, display-size number, a line of context, and an optional progress bar. */
export function RStat({ label, value, of, sub, progress, className }: {
  label: React.ReactNode; value: React.ReactNode; of?: React.ReactNode; sub?: React.ReactNode; progress?: number; className?: string;
}) {
  return (
    <RCard className={cn("gap-1", className)}>
      <span className="text-[13px] font-bold text-r-muted first-letter:uppercase">{label}</span>
      <span className="disp num text-[48px] leading-none font-bold">
        {value}{of !== undefined && <span className="text-[26px] text-r-muted"> / {of}</span>}
      </span>
      {sub && <span className="text-r-muted">{sub}</span>}
      {progress !== undefined && (
        <div className="mt-2 h-2 rounded bg-r-sunk" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-2 rounded bg-r-action" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      )}
    </RCard>
  );
}
