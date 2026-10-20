import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { api, type Me } from "@/lib/api";
import { useLogout, useUser } from "@/lib/auth";
import { useLang, useT, type TKey } from "@/lib/i18n";
import { RAlert, RButton, RCard, RCardTitle, RChip, RInput, RLabel, RPage, RSegmented, RTitle } from "@/components/reports/kit";
import { useTheme } from "@/components/Layout";

/** Who you are, language, appearance, password, sign out. The district phone's fourth tab. */
export default function AccountPage() {
  const me = useUser();
  const { t, name } = useT();
  const { lang, setLang } = useLang();
  const { dark, toggle } = useTheme();
  const logout = useLogout();
  const where = me.office ? name(me.office) : me.division?.label_mr ?? "";
  return (
    <RPage className="mx-auto w-full max-w-[720px]">
      <RTitle title={t("nav_account")} />
      <RCard>
        <span className="text-[13px] font-bold text-r-muted">{t("signed_in_as")}</span>
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-lg">{me.display_name || me.username}</b>
          <RChip tone="outline">{me.username}</RChip>
        </div>
        <span className="text-r-muted">{t(("role_" + me.role) as TKey)}{where && ` · ${where}`}</span>
      </RCard>
      <RCard>
        <RLabel label={t("language")} htmlFor="lang-seg">
          <div id="lang-seg"><RSegmented full label={t("language")} value={lang} onChange={setLang} className="[&>button]:min-h-11"
            options={[{ value: "mr", label: "मराठी" }, { value: "en", label: "English" }]} /></div>
        </RLabel>
        <RLabel label={t("appearance")} htmlFor="theme-seg">
          <div id="theme-seg"><RSegmented full label={t("appearance")} value={dark ? "dark" : "light"} onChange={(v) => (v === "dark") !== dark && toggle()} className="[&>button]:min-h-11"
            options={[{ value: "light", label: t("theme_light") }, { value: "dark", label: t("theme_dark") }]} /></div>
        </RLabel>
      </RCard>
      <PasswordCard />
      <RButton size="lg" variant="danger" onClick={logout}><LogOut aria-hidden /> {t("logout")}</RButton>
    </RPage>
  );
}

function PasswordCard() {
  const { t } = useT();
  const qc = useQueryClient();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [repeat, setRepeat] = React.useState("");
  const change = useMutation({
    mutationFn: () => api.post<Me>("/api/auth/password", { current_password: current, new_password: next }),
    onSuccess: (m) => { qc.setQueryData(["me"], m); toast.success(t("pw_changed")); setCurrent(""); setNext(""); setRepeat(""); },
  });
  const mismatch = repeat.length > 0 && next !== repeat;
  return (
    <RCard>
      <RCardTitle>{t("change_pw")}</RCardTitle>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (!mismatch) change.mutate(); }}>
        <RLabel label={t("current_password")}><RInput big type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></RLabel>
        <RLabel label={t("new_password")}><RInput big type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></RLabel>
        <RLabel label={t("type_again")} error={mismatch ? t("pw_not_same") : undefined}>
          <RInput big type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} aria-invalid={mismatch || undefined} />
        </RLabel>
        {change.error && <RAlert tone="danger">{change.error.message}</RAlert>}
        <RButton type="submit" variant="pri" size="lg" loading={change.isPending} disabled={!current || next.length < 8 || next !== repeat || next === current}>
          {t("save_password")}
        </RButton>
      </form>
    </RCard>
  );
}
