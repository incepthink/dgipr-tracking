import * as React from "react";
import { Link } from "react-router-dom";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, KeyRound, Languages, LogOut, Moon, Sun, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLogout, useUser } from "@/lib/auth";
import { useLang, useT, type TKey } from "@/lib/i18n";
import { RChip, RSheet } from "@/components/reports/kit";
import { PasswordForm } from "@/pages/Account";
import { useTheme } from "@/components/Layout";

/** Who is signed in: name on top, their office (or division) under it; the role sits in the menu. */
function useIdentity() {
  const me = useUser();
  const { t, shortName, name } = useT();
  const role = t(("u_role_" + me.role) as TKey);
  const raw = (me.display_name || "").trim();
  // Seeded accounts are often named after their role ("State admin"); then the role is the name and nothing repeats.
  const generic = !raw || [role, t(("role_" + me.role) as TKey)].some((r) => r.toLowerCase() === raw.toLowerCase());
  const title = generic ? role : raw;
  const where = me.role === "district" ? shortName(me.office)
    : me.role === "zone" ? me.division?.label_mr ?? ""
    : me.office ? name(me.office) : "";
  const initials = (generic ? me.username : raw).split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return { me, role, title, where, initials, generic };
}

function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-8 shrink-0 place-items-center rounded-full bg-r-ink text-xs font-bold text-r-card", className)}>
      {initials || "?"}
    </span>
  );
}

const ITEM = "flex min-h-9 cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 text-sm outline-none data-[highlighted]:bg-r-sunk [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-r-muted";
const LABEL = "px-2.5 pt-1.5 pb-1 text-[11px] font-bold tracking-[0.08em] text-r-faint uppercase";

/** The header's account control: avatar + name, opening a menu with account, password, language, theme and sign out. */
export function UserMenu() {
  const { me, role, title, where, initials, generic } = useIdentity();
  const { t } = useT();
  const { lang, setLang } = useLang();
  const { dark, toggle } = useTheme();
  const logout = useLogout();
  const [pwOpen, setPwOpen] = React.useState(false);

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-full py-1 pr-2 pl-1 text-left outline-none hover:bg-r-sunk focus-visible:ring-2 focus-visible:ring-r-focus data-[state=open]:bg-r-sunk"
          aria-label={`${t("nav_account")}: ${title}`}>
          <Avatar initials={initials} />
          <span className="hidden min-w-0 leading-tight sm:block">
            <span className="block max-w-[200px] truncate text-sm font-bold">{title}</span>
            {(where || !generic) && (
              <span className="block max-w-[200px] truncate text-xs text-r-muted">{where || role}</span>
            )}
          </span>
          <ChevronDown className="hidden size-4 shrink-0 text-r-muted sm:block" aria-hidden />
        </Menu.Trigger>

        <Menu.Portal>
          <Menu.Content align="end" sideOffset={8}
            className="z-50 w-72 rounded-xl border border-r-line bg-r-card p-1.5 font-body text-r-ink shadow-lg">
            <div className="flex items-start gap-3 px-2.5 pt-2 pb-3">
              <Avatar initials={initials} className="size-10 text-sm" />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate font-bold">{title}</div>
                {where && <div className="mt-0.5 truncate text-xs text-r-muted">{where}</div>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <RChip tone="ink">{role}</RChip>
                  <RChip tone="outline">{me.username}</RChip>
                </div>
              </div>
            </div>
            <Menu.Separator className="my-1 h-px bg-r-line" />

            {/* Account settings all live in this menu, so only the state admin gets a link here: user management. */}
            {me.role === "state" && (
              <Menu.Item asChild className={ITEM}>
                <Link to="/admin/users" className="text-r-ink no-underline"><UserCog /> {t("nav_users")}</Link>
              </Menu.Item>
            )}
            <Menu.Item className={ITEM} onSelect={() => setPwOpen(true)}><KeyRound /> {t("change_pw")}</Menu.Item>
            <Menu.Separator className="my-1 h-px bg-r-line" />

            <Menu.Label className={LABEL}>{t("language")}</Menu.Label>
            <Menu.RadioGroup value={lang} onValueChange={(v) => setLang(v as typeof lang)}>
              {([["mr", "मराठी"], ["en", "English"]] as const).map(([v, label]) => (
                <Menu.RadioItem key={v} value={v} className={ITEM} onSelect={(e) => e.preventDefault()}>
                  <Languages /> <span className="flex-1">{label}</span>
                  <Menu.ItemIndicator><Check className="size-4 text-r-action" /></Menu.ItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <Menu.Separator className="my-1 h-px bg-r-line" />

            <Menu.Label className={LABEL}>{t("display")}</Menu.Label>
            <Menu.RadioGroup value={dark ? "dark" : "light"} onValueChange={(v) => (v === "dark") !== dark && toggle()}>
              {([["light", Sun, "theme_light"], ["dark", Moon, "theme_dark"]] as const).map(([v, Icon, label]) => (
                <Menu.RadioItem key={v} value={v} className={ITEM} onSelect={(e) => e.preventDefault()}>
                  <Icon /> <span className="flex-1">{t(label)}</span>
                  <Menu.ItemIndicator><Check className="size-4 text-r-action" /></Menu.ItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <Menu.Separator className="my-1 h-px bg-r-line" />

            <Menu.Item className={cn(ITEM, "font-bold text-r-overdue [&>svg]:text-r-overdue data-[highlighted]:bg-r-overdue-soft")} onSelect={logout}>
              <LogOut /> {t("logout")}
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>

      <RSheet open={pwOpen} onClose={() => setPwOpen(false)} title={t("change_pw")} closeLabel={t("close")}>
        <PasswordForm onDone={() => setPwOpen(false)} />
      </RSheet>
    </>
  );
}
