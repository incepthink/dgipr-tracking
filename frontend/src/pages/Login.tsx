import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Circle, Languages } from "lucide-react";
import { api, ApiError, type Me } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RAlert, RButton, RInput, RLabel } from "@/components/reports/kit";

function LangToggle({ className }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <button type="button" onClick={() => setLang(lang === "mr" ? "en" : "mr")}
      className={cn("inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-bold", className)}>
      <Languages className="size-4" aria-hidden /> {lang === "mr" ? "English" : "मराठी"}
    </button>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, invalid, describedBy }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean; describedBy?: string;
}) {
  const { t } = useT();
  const [shown, setShown] = React.useState(false);
  return (
    <div className="relative">
      <RInput big id={id} type={shown ? "text" : "password"} autoComplete={autoComplete} value={value}
        onChange={(e) => onChange(e.target.value)} className="pr-[76px]" aria-invalid={invalid || undefined} aria-describedby={describedBy} />
      <button type="button" onClick={() => setShown(!shown)} aria-pressed={shown}
        className="absolute top-1.5 right-1.5 h-[42px] cursor-pointer rounded-lg border-0 bg-transparent px-3 font-bold text-r-action">
        {shown ? t("pw_hide") : t("pw_show")}
      </button>
    </div>
  );
}

export default function LoginPage() {
  const { t } = useT();
  const qc = useQueryClient();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const login = useMutation({
    mutationFn: () => api.post<Me>("/api/auth/login", { username, password }),
    // Keep the ["me"] query (AuthGate observes it); drop anything cached for a previous user.
    onSuccess: (me) => { qc.setQueryData(["me"], me); qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" }); },
  });
  const err = login.error;
  const [signedOut] = React.useState(() => { try { const v = sessionStorage.getItem("signed_out"); sessionStorage.removeItem("signed_out"); return !!v; } catch { return false; } });
  const badCreds = err instanceof ApiError && (err.status === 401 || err.status === 400);
  return (
    <div className="rpt flex min-h-screen flex-col text-base">
      <div className="bg-r-nav text-white">
        <div className="mx-auto flex w-full max-w-[440px] flex-col gap-4 px-6 pt-10 pb-8 sm:pt-14">
          <div className="flex items-start justify-between gap-3">
            <div className="flex size-14 items-center justify-center rounded-xl bg-white/10 disp text-2xl font-bold" aria-hidden>D</div>
            <LangToggle className="text-r-nav-text hover:bg-white/10 hover:text-white" />
          </div>
          <div className="text-sm leading-snug text-r-nav-text">{t("login_org")}</div>
          <h1 className="disp m-0 text-[36px] leading-[1.05] font-bold">{t("login_heading")}</h1>
        </div>
      </div>

      <form className="mx-auto flex w-full max-w-[440px] flex-1 flex-col gap-[18px] px-6 py-7"
        onSubmit={(e) => { e.preventDefault(); login.mutate(); }}>
        {signedOut && !err && <RAlert tone="info" title={t("signed_out_title")}>{t("signed_out_body")}</RAlert>}
        {err && <RAlert tone="danger">{badCreds ? t("login_failed") : err.message}</RAlert>}
        <RLabel label={t("username")} htmlFor="u">
          <RInput big id="u" autoFocus autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />
        </RLabel>
        <RLabel label={t("password")} htmlFor="p">
          <PasswordInput id="p" autoComplete="current-password" value={password} onChange={setPassword} />
        </RLabel>
        <RButton type="submit" variant="pri" size="lg" className="mt-1.5" loading={login.isPending} disabled={!username || !password}>
          {t("login_btn")}
        </RButton>
        <div className="mt-auto flex flex-col gap-1 rounded-xl bg-r-card p-4 text-[15px] text-r-muted">
          <b className="text-r-ink">{t("forgot_title")}</b>
          <span>{t("forgot_body")}</span>
        </div>
      </form>
    </div>
  );
}

function Rule({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      {ok ? <Check className="size-5 text-r-accepted" strokeWidth={2.6} aria-hidden /> : <Circle className="size-5 text-r-faint" aria-hidden />}
      <span className={ok ? "" : "text-r-muted"}>{children}</span>
    </li>
  );
}

export function ChangePasswordPage({ me }: { me?: Me }) {
  const { t, name } = useT();
  const qc = useQueryClient();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [repeat, setRepeat] = React.useState("");
  const change = useMutation({
    mutationFn: () => api.post<Me>("/api/auth/password", { current_password: current, new_password: next }),
    onSuccess: (m) => { qc.setQueryData(["me"], m); qc.invalidateQueries(); },
  });
  const longEnough = next.length >= 8;
  const differs = next.length > 0 && next !== current;
  const mismatch = repeat.length > 0 && next !== repeat;
  const where = me ? (me.office ? name(me.office) : me.division?.label_mr || me.display_name) : "";
  return (
    <div className="rpt flex min-h-screen flex-col text-base">
      <div className="mx-auto flex w-full max-w-[440px] flex-col gap-2.5 px-6 pt-10 pb-5 sm:pt-14">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-bold text-r-muted">{where}</div>
          <LangToggle className="-mr-3 text-r-muted hover:bg-r-sunk" />
        </div>
        <h1 className="disp m-0 text-[32px] leading-[1.1] font-bold">{t("first_pw_title")}</h1>
        <p className="m-0 text-r-muted">{t("first_pw_sub")}</p>
      </div>

      <form className="mx-auto flex w-full max-w-[440px] flex-1 flex-col gap-[18px] px-6 pt-2 pb-7"
        onSubmit={(e) => { e.preventDefault(); if (!mismatch) change.mutate(); }}>
        <RLabel label={t("temp_password")} htmlFor="cur">
          <PasswordInput id="cur" autoComplete="current-password" value={current} onChange={setCurrent} />
        </RLabel>
        <RLabel label={t("new_password_short")} htmlFor="np">
          <PasswordInput id="np" autoComplete="new-password" value={next} onChange={setNext} describedBy="rules" />
        </RLabel>
        <ul id="rules" className="m-0 flex list-none flex-col gap-2.5 rounded-xl bg-r-card px-4 py-3.5 text-[15px]">
          <Rule ok={longEnough}>{t("pw_rule_len")}</Rule>
          <Rule ok={differs}>{t("pw_rule_diff")}</Rule>
        </ul>
        <RLabel label={t("type_again")} htmlFor="cp" error={mismatch ? t("pw_not_same") : undefined}>
          <PasswordInput id="cp" autoComplete="new-password" value={repeat} onChange={setRepeat} invalid={mismatch} />
        </RLabel>
        {change.error && <RAlert tone="danger">{change.error.message}</RAlert>}
        <RButton type="submit" variant="pri" size="lg" className="mt-auto" loading={change.isPending}
          disabled={!current || !longEnough || !differs || next !== repeat}>
          {t("save_continue")}
        </RButton>
        <p className="m-0 text-center text-sm text-r-muted">{t("pw_keep_safe")}</p>
      </form>
    </div>
  );
}
