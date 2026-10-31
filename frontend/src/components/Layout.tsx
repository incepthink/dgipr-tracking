import * as React from "react";
import { Link, NavLink, Outlet, useLocation, useSearchParams } from "react-router-dom";
import {
  Activity, BarChart3, CircleUserRound, ClipboardCheck, ClipboardList, Clock3,
  Inbox, KeyRound, Languages, LayoutDashboard, LayoutGrid, LogOut, MapPinned, Menu, Moon, Newspaper, Sheet, Sun, UserCog, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLogout, useUser } from "@/lib/auth";
import { useLang, useT, type TKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { AttentionBell, useInboxCount } from "@/pages/forms/MyForms";
import { OfflineBanner, RSheet } from "@/components/reports/kit";
import { PasswordForm } from "@/pages/Account";
import type { Role } from "@/lib/api";
import emblem from "@/assets/maharashtra-emblem.png";

/** Reports section (अहवाल): offices fill their forms; the state admin builds forms and reviews responses. */
type NavItem = { to: string; label: TKey; hint: TKey; icon: React.ElementType; roles: Role[]; badge?: boolean };
const OFFICE: NavItem[] = [
  { to: "/office/desk", label: "nav_desk", hint: "nav_desk_hint", icon: Inbox, roles: ["state"] },
  { to: "/office/board", label: "nav_board", hint: "nav_board_hint", icon: LayoutGrid, roles: ["zone"] },
  { to: "/forms/mine", label: "nav_today", hint: "nav_today_hint", icon: Clock3, roles: ["district"], badge: true },
  { to: "/forms", label: "nav_forms", hint: "nav_forms_hint", icon: ClipboardList, roles: ["state"] },
  { to: "/forms/responses", label: "nav_responses", hint: "nav_responses_hint", icon: ClipboardCheck, roles: ["state"] },
  { to: "/office/analytics", label: "nav_my_numbers", hint: "nav_my_numbers_hint", icon: BarChart3, roles: ["district"] },
  { to: "/office/reports", label: "nav_reports", hint: "nav_reports_hint", icon: Sheet, roles: ["district", "zone", "state"] },
];

/** The district office's phone tabs (the design's bottom bar). */
const DISTRICT_TABS: { to: string; label: TKey; icon: React.ElementType; match: (p: string, q: URLSearchParams) => boolean }[] = [
  { to: "/forms/mine", label: "nav_today", icon: Clock3, match: (p, q) => p === "/forms/mine" && q.get("view") !== "forms" },
  { to: "/forms/mine?view=forms", label: "nav_my_forms", icon: ClipboardList, match: (p, q) => p === "/forms/mine" && q.get("view") === "forms" },
  { to: "/office/analytics", label: "nav_my_numbers", icon: BarChart3, match: (p) => p.startsWith("/office/analytics") },
  { to: "/account", label: "nav_account", icon: CircleUserRound, match: (p) => p === "/account" },
];

function DistrictTabBar() {
  const { t } = useT();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const pending = useInboxCount();
  return (
    <nav aria-label={t("nav_office")} className="fixed inset-x-0 bottom-0 z-40 flex border-t border-r-line bg-r-card pb-[env(safe-area-inset-bottom)] font-body lg:hidden">
      {DISTRICT_TABS.map((tab) => {
        const on = tab.match(pathname, params);
        return (
          <Link key={tab.to} to={tab.to} aria-current={on ? "page" : undefined}
            className={cn("relative flex min-h-[60px] flex-1 flex-col items-center justify-center gap-0.5 text-xs font-bold no-underline",
              on ? "text-r-ink shadow-[inset_0_3px_0_var(--r-focus)]" : "text-r-muted")}>
            <tab.icon className="size-6" strokeWidth={2.2} aria-hidden />
            {t(tab.label)}
            {tab.to === "/forms/mine" && pending > 0 && (
              <span className="num absolute top-1.5 left-1/2 ml-2 rounded-full bg-r-focus px-1.5 text-[11px] text-[#15202b]">{pending}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

const ADMIN: { to: string; label: TKey; icon: React.ElementType }[] = [
  { to: "/admin/users", label: "nav_users", icon: UserCog },
];

/** The nav item whose path is the longest prefix of the current path is the active one. */
function activeOf(pathname: string) {
  return OFFICE.map((o) => o.to).filter((to) => pathname === to || pathname.startsWith(to + "/"))
    .sort((a, b) => b.length - a.length)[0];
}

/** Insights (post analytics) for the state and zone offices. */
const INSIGHTS: { to: string; label: TKey; icon: React.ElementType; end?: boolean }[] = [
  { to: "/insights", label: "ins_overview", icon: LayoutDashboard, end: true },
  { to: "/insights/posts", label: "ins_posts", icon: Newspaper },
  { to: "/insights/districts", label: "ins_districts", icon: MapPinned },
];

/** Social monitoring is one page; these sit under it in the sidebar. */
const MONITOR_SUB: { to: string; label: TKey }[] = [
  { to: "/runs", label: "nav_run_history" },
  { to: "/accounts", label: "nav_accounts" },
  { to: "/campaigns", label: "nav_search_terms" },
  { to: "/audit", label: "nav_audit" },
];

/** Report pages (forms, office analytics/tables, users) use the reports workspace look. */
export function isReportsPath(pathname: string) {
  return /^\/(forms|office|admin|account|monitor|insights)(\/|$)/.test(pathname);
}

/** Light/dark, shared by every caller (header button and the Account page) through a window event. */
export function useTheme() {
  const [dark, setDark] = React.useState(() => document.documentElement.classList.contains("dark"));
  React.useEffect(() => {
    const on = () => setDark(document.documentElement.classList.contains("dark"));
    window.addEventListener("themechange", on);
    return () => window.removeEventListener("themechange", on);
  }, []);
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event("themechange"));
  };
  return { dark, toggle };
}

const ACTIVE = "bg-sidebar-accent text-white shadow-[inset_3px_0_0_var(--r-focus)]";

const navCls = (active: boolean) =>
  cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-bold transition-colors hover:bg-sidebar-accent hover:text-white", active && ACTIVE);

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 px-3 text-[11px] font-bold tracking-[0.08em] text-sidebar-muted uppercase">{children}</div>;
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const me = useUser();
  const { t } = useT();
  const { pathname } = useLocation();
  const isState = me.role === "state";
  const pending = useInboxCount();
  const current = activeOf(pathname);
  const [pwOpen, setPwOpen] = React.useState(false);
  const monitorActive = /^\/(monitor|publications|reports)(\/|$)/.test(pathname);
  const analytics = me.role !== "district" && (
    <div>
      <SectionLabel>{t("nav_analytics_beta")}</SectionLabel>
      <div className="space-y-0.5">
        {INSIGHTS.map((m) => (
          <NavLink key={m.to} to={m.to} end={m.end} onClick={onNavigate} className={({ isActive }) => navCls(isActive)}>
            <m.icon className="size-4" /> {t(m.label)}
          </NavLink>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-sidebar font-body text-sidebar-foreground">
      <Link to="/" onClick={onNavigate} className="flex items-center gap-3 px-5 py-5">
        <img src={emblem} alt="" className="size-9 shrink-0" />
        <div className="leading-tight">
          <div className="disp text-base font-bold text-white">{t("app_title")}</div>
          <div className="text-xs text-sidebar-muted">{t("app_sub")}</div>
        </div>
      </Link>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {/* The state admin's day starts in Reports, so it leads their sidebar; zones still open on Analytics. */}
        {!isState && analytics}

        <div>
          <SectionLabel>{t("nav_office")}</SectionLabel>
          <div className="space-y-0.5">
            {OFFICE.filter((o) => o.roles.includes(me.role)).map((o) => {
              const active = current === o.to || (o.to === "/forms/mine" && /^\/forms\/\d+\/fill/.test(pathname));
              return (
                <Link key={o.to + o.label} to={o.to} onClick={onNavigate}
                  className={cn("flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-sidebar-accent", active && ACTIVE)}>
                  <o.icon className={cn("size-4 shrink-0", active && "text-white")} />
                  <span className="leading-tight">
                    <span className={cn("block text-sm font-bold", active && "text-white")}>{t(o.label)}</span>
                    <span className="block text-xs text-sidebar-muted">{t(o.hint)}</span>
                  </span>
                  {o.badge && pending > 0 && me.role === "district" && (
                    <span className="num ml-auto rounded-full bg-r-focus px-1.5 py-0.5 text-[11px] font-semibold text-[#15202b]">{pending}</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>

        {isState && analytics}

        {isState && (
          <div>
            <SectionLabel>{t("nav_monitoring_beta")}</SectionLabel>
            <Link to="/monitor" onClick={onNavigate} aria-current={monitorActive ? "page" : undefined}
              className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold transition-colors hover:bg-sidebar-accent", monitorActive && ACTIVE)}>
              <Activity className="size-4" /> <span className="flex-1">{t("nav_monitoring")}</span>
            </Link>
            <div className="mt-2 ml-3 flex flex-col gap-0.5 border-l border-sidebar-accent pl-4">
              {MONITOR_SUB.map((m) => (
                <NavLink key={m.to} to={m.to} onClick={onNavigate}
                  className={({ isActive }) => cn("rounded-md px-2 py-1.5 text-[13px] text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-white",
                    isActive && "bg-sidebar-accent font-bold text-white")}>
                  {t(m.label)}
                </NavLink>
              ))}
            </div>
          </div>
        )}

        <div>
          <SectionLabel>{t("nav_account")}</SectionLabel>
          <div className="space-y-0.5">
            {isState && ADMIN.map((m) => (
              <NavLink key={m.to} to={m.to} onClick={onNavigate} className={({ isActive }) => navCls(isActive)}>
                <m.icon className="size-4" /> {t(m.label)}
              </NavLink>
            ))}
            <button type="button" onClick={() => setPwOpen(true)} className={cn(navCls(false), "w-full cursor-pointer text-left")}>
              <KeyRound className="size-4" /> {t("change_pw")}
            </button>
          </div>
        </div>
      </nav>
      <RSheet open={pwOpen} onClose={() => setPwOpen(false)} title={t("change_pw")} closeLabel={t("close")}>
        <PasswordForm onDone={() => { setPwOpen(false); onNavigate?.(); }} />
      </RSheet>

      <div className="border-t border-sidebar-accent px-5 py-4 text-xs text-sidebar-muted">
        <div>Dates are calendar days in Asia/Kolkata.</div>
      </div>
    </div>
  );
}

function UserBadge() {
  const me = useUser();
  const { t, shortName } = useT();
  const where = me.role === "zone" ? me.division?.label_mr : me.role === "district" ? shortName(me.office) : "";
  return (
    <div className="min-w-0 text-right leading-tight">
      <div className="truncate text-sm font-medium">{me.display_name || me.username}</div>
      <div className="truncate text-xs text-muted-foreground">
        {/* On a phone the office alone says enough; the role prefix returns from sm up. */}
        <span className={cn(where && "hidden sm:inline")}>{t(("role_" + me.role) as TKey)}{where ? " · " : ""}</span>{where}
      </div>
    </div>
  );
}

export function Layout() {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const { dark, toggle } = useTheme();
  const { pathname } = useLocation();
  const { lang, setLang } = useLang();
  const { t } = useT();
  const logout = useLogout();

  React.useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  const reports = isReportsPath(pathname);
  const me = useUser();
  // District offices on a phone move between their four places with a bottom tab bar (not while filling).
  const tabs = me.role === "district" && !/^\/forms\/\d+\/fill/.test(pathname);

  return (
    <div className={cn("min-h-screen lg:pl-64", reports && "bg-r-ground font-body")}>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block"><Sidebar /></aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-xl">
            <button className="absolute top-5 right-3 z-10 text-sidebar-foreground cursor-pointer" onClick={() => setMobileOpen(false)}><X className="size-5" /></button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <header className={cn("sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur sm:px-6", reports ? "border-r-line bg-r-ground/85 text-r-ink" : "bg-background/85")}>
        <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen(true)}><Menu /></Button>
        <div className="flex-1" />
        <AttentionBell />
        <UserBadge />
        <Button variant="ghost" size="sm" onClick={() => setLang(lang === "mr" ? "en" : "mr")} title="मराठी / English">
          <Languages /> <span className="hidden sm:inline">{lang === "mr" ? "EN" : "मरा"}</span>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={toggle} title="Toggle theme">{dark ? <Sun /> : <Moon />}</Button>
        <Button variant="ghost" size="icon-sm" onClick={logout} title={t("logout")}><LogOut /></Button>
      </header>

      <main className={cn("mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8", pathname === "/office/board" ? "max-w-[1840px]" : "max-w-[1400px]", tabs && "pb-28 lg:pb-8")}>
        {reports && <OfflineBanner />}
        <Outlet />
      </main>
      {tabs && <DistrictTabBar />}
    </div>
  );
}
