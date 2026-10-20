import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Download, Plus, Search, Users as UsersIcon } from "lucide-react";
import { api, type Role, type UserRow } from "@/lib/api";
import { useAction, useMeta } from "@/lib/hooks";
import { useUser } from "@/lib/auth";
import { useT, type TKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RAlert, RButton, RError, RInput, RLabel, RPage, RSelect, RSheet, RTitle } from "@/components/reports/kit";
import { whenText } from "@/components/reports/period";

type Form = { username: string; display_name: string; role: Role; office_code: string; division_code: string };
const EMPTY: Form = { username: "", display_name: "", role: "district", office_code: "", division_code: "" };

function downloadCsv(rows: UserRow[]) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [["username", "temp_password", "role", "office", "division", "display_name"].join(","),
    ...rows.map((u) => [u.username, u.temp_password ?? "", u.role, u.office_code ?? "", u.division_code ?? "", u.display_name].map(esc).join(","))];
  const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `dgipr_accounts_${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

type StatusKey = "active" | "must" | "off";
const statusOf = (u: UserRow): StatusKey => (!u.active ? "off" : u.must_change_password ? "must" : "active");

/** Accounts in official order: the state team, then each division's zone officer and its offices. */
export default function UsersPage() {
  const me = useUser();
  const { t, tf, name, lang } = useT();
  const { data: meta } = useMeta();
  const { data, error, isLoading } = useQuery({ queryKey: ["users"], queryFn: () => api.get<UserRow[]>("/api/users") });
  const [q, setQ] = React.useState("");
  const [role, setRole] = React.useState<"" | Role>("");
  const [st, setSt] = React.useState<"" | StatusKey>("");
  const [editing, setEditing] = React.useState<{ id: number | null; form: Form } | null>(null);
  const [secrets, setSecrets] = React.useState<{ rows: UserRow[]; bulk: boolean } | null>(null);
  const offices = React.useMemo(() => meta?.divisions.flatMap((d) => d.offices.map((o) => ({ ...o, division: d.code }))) ?? [], [meta]);
  const officeName = (c: string | null) => name(offices.find((o) => o.code === c)) || "";
  const divName = (c: string | null) => meta?.divisions.find((d) => d.code === c)?.label_mr ?? "";

  const save = useAction((f: { id: number | null; form: Form }) => f.id
    ? api.patch<UserRow>(`/api/users/${f.id}`, f.form)
    : api.post<UserRow>("/api/users", { ...f.form, office_code: f.form.office_code || null, division_code: f.form.division_code || null }), {
    invalidate: [["users"]], success: t("saved"),
    onSuccess: (r) => { setEditing(null); if (r.temp_password) setSecrets({ rows: [r], bulk: false }); },
  });
  const toggle = useAction((u: UserRow) => api.patch<UserRow>(`/api/users/${u.id}`, { active: !u.active }), { invalidate: [["users"]] });
  const reset = useAction((u: UserRow) => api.post<UserRow>(`/api/users/${u.id}/reset-password`), {
    invalidate: [["users"]], onSuccess: (r) => setSecrets({ rows: [r], bulk: false }),
  });
  const bulk = useAction(() => api.post<{ created: UserRow[] }>("/api/users/bulk-create"), {
    invalidate: [["users"]], success: (r) => tf("n_accounts_created", { n: r.created.length }),
    onSuccess: (r) => { if (r.created.length) setSecrets({ rows: r.created, bulk: true }); },
  });

  // official order: state, then per division: zone account, then its offices in order
  const order = React.useMemo(() => {
    const officeIdx = new Map(offices.map((o, i) => [o.code, i]));
    const divIdx = new Map((meta?.divisions ?? []).map((d, i) => [d.code, i]));
    return (u: UserRow) => u.role === "state" ? -1 : (divIdx.get(u.division_code ?? offices.find((o) => o.code === u.office_code)?.division ?? "") ?? 99) * 1000
      + (u.role === "zone" ? 0 : 1 + (officeIdx.get(u.office_code ?? "") ?? 900));
  }, [offices, meta]);
  const rows = (data ?? [])
    .filter((u) => !q || `${u.username} ${u.display_name} ${officeName(u.office_code)} ${divName(u.division_code)}`.toLowerCase().includes(q.toLowerCase()))
    .filter((u) => !role || u.role === role).filter((u) => !st || statusOf(u) === st)
    .sort((a, b) => order(a) - order(b) || a.username.localeCompare(b.username));
  const bandOf = (u: UserRow) => u.role === "state" ? t("state_office") : `${divName(u.division_code ?? offices.find((o) => o.code === u.office_code)?.division ?? "") || "—"}`;
  const f = editing?.form;
  const setF = (patch: Partial<Form>) => setEditing((e) => e && { ...e, form: { ...e.form, ...patch } });

  const STATUS: Record<StatusKey, { cls: string; dot: string; label: TKey }> = {
    active: { cls: "text-r-accepted", dot: "size-2 rounded-full bg-r-accepted", label: "u_active" },
    must: { cls: "text-r-returned-ink", dot: "size-2 rounded-[2px] bg-r-returned", label: "u_must_set" },
    off: { cls: "text-r-muted", dot: "size-2 rounded-full border-2 border-r-faint", label: "u_deactivated" },
  };
  const roleLabel = (r: Role) => t(`u_role_${r}` as TKey);
  const zoneCount = meta?.divisions.length ?? 0;

  return (
    <RPage>
      <RTitle title={t("nav_users")} sub={t("users_sub")}
        actions={<>
          <RButton onClick={() => setEditing({ id: null, form: EMPTY })}><Plus aria-hidden /> {t("new_user")}</RButton>
          <RButton variant="pri" loading={bulk.isPending} onClick={() => confirm(tf("bulk_confirm", { o: offices.length, d: zoneCount })) && bulk.mutate(undefined)}>
            <UsersIcon aria-hidden /> {t("create_all_accounts")}
          </RButton>
        </>} />
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative w-full max-w-[300px]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-r-muted" aria-hidden />
          <RInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search_users")} aria-label={t("search_users")} className="pl-8" />
        </div>
        <RSelect aria-label={t("role")} value={role} onChange={(e) => setRole(e.target.value as Role | "")}>
          <option value="">{t("all_roles")}</option>
          {(["district", "zone", "state"] as Role[]).map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </RSelect>
        <RSelect aria-label={t("status")} value={st} onChange={(e) => setSt(e.target.value as StatusKey | "")}>
          <option value="">{t("any_status")}</option>
          {(["active", "must", "off"] as StatusKey[]).map((s) => <option key={s} value={s}>{t(STATUS[s].label)}</option>)}
        </RSelect>
      </div>

      {error ? <RError error={error} /> : isLoading ? <div className="h-96 animate-pulse rounded-xl bg-r-sunk" /> : (
        <div className="overflow-x-auto rounded-xl border border-r-line bg-r-card scrollbar-thin">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-xs text-r-muted">
                {[t("username"), t("office_or_division"), t("role"), t("status"), t("last_signed_in")].map((h) => <th key={h} scope="col" className="h-[38px] border-b-[1.5px] border-r-ink px-3 text-left font-bold whitespace-nowrap">{h}</th>)}
                <th scope="col" className="border-b-[1.5px] border-r-ink"><span className="sr-only">{t("actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u, i) => {
                const band = i === 0 || bandOf(rows[i - 1]) !== bandOf(u);
                const s = STATUS[statusOf(u)];
                return (
                  <React.Fragment key={u.id}>
                    {band && <tr><td colSpan={6} className="h-[34px] bg-r-sunk px-3 font-bold">{bandOf(u)}</td></tr>}
                    <tr className={cn("border-b border-r-sunk", !u.active && "text-r-muted")}>
                      <td className="num h-[46px] px-3 whitespace-nowrap">{u.username}</td>
                      <td className="px-3">{u.role === "zone" ? divName(u.division_code) : u.role === "state" ? u.display_name : officeName(u.office_code) || u.display_name}</td>
                      <td className="px-3 whitespace-nowrap">{roleLabel(u.role)}</td>
                      <td className="px-3 whitespace-nowrap"><span className={cn("inline-flex items-center gap-1.5 text-[13px] font-bold", s.cls)}><span className={s.dot} aria-hidden />{t(s.label)}</span></td>
                      <td className="px-3 whitespace-nowrap text-r-muted">{u.last_login_at ? whenText(u.last_login_at.endsWith("Z") ? u.last_login_at : u.last_login_at + "Z", lang) : t("never")}</td>
                      <td className="px-3 text-right whitespace-nowrap">
                        <span className="inline-flex gap-1.5">
                          <RButton size="sm" variant="ghost" onClick={() => setEditing({ id: u.id, form: { username: u.username, display_name: u.display_name, role: u.role, office_code: u.office_code ?? "", division_code: u.division_code ?? "" } })}>{t("edit")}</RButton>
                          <RButton size="sm" onClick={() => confirm(tf("reset_confirm", { u: u.username })) && reset.mutate(u)}>{t("reset_password")}</RButton>
                          {u.id !== me.id && <RButton size="sm" className="border-r-field" onClick={() => toggle.mutate(u)}>{u.active ? t("deactivate") : t("reactivate")}</RButton>}
                        </span>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
              {!rows.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-r-muted">{t("no_users_match")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <RSheet open={!!editing} onClose={() => setEditing(null)} closeLabel={t("discard")} title={editing?.id ? t("edit_user") : t("new_user")}
        description={editing?.id ? undefined : t("new_user_sub")}
        footer={<div className="flex justify-end gap-2">
          <RButton variant="ghost" onClick={() => setEditing(null)}>{t("discard")}</RButton>
          <RButton variant="pri" loading={save.isPending} disabled={!f?.username} onClick={() => editing && save.mutate(editing)}>{t("save")}</RButton>
        </div>}>
        {f && (
          <div className="flex flex-col gap-3.5">
            <RLabel label={t("username")}><RInput value={f.username} disabled={!!editing?.id} onChange={(e) => setF({ username: e.target.value })} autoCapitalize="none" className="num" /></RLabel>
            <RLabel label={t("display_name")}><RInput value={f.display_name} onChange={(e) => setF({ display_name: e.target.value })} /></RLabel>
            <RLabel label={t("role")}>
              <RSelect value={f.role} onChange={(e) => setF({ role: e.target.value as Role })} className="w-full">
                {(["district", "zone", "state"] as Role[]).map((r) => <option key={r} value={r}>{roleLabel(r)} · {t(`u_role_${r}_hint` as TKey)}</option>)}
              </RSelect>
            </RLabel>
            {f.role === "zone" && (
              <RLabel label={t("division")}>
                <RSelect value={f.division_code} onChange={(e) => setF({ division_code: e.target.value })} className="w-full">
                  <option value="">—</option>
                  {meta?.divisions.map((d) => <option key={d.code} value={d.code}>{d.label_mr}</option>)}
                </RSelect>
              </RLabel>
            )}
            {f.role === "district" && (
              <RLabel label={t("office")}>
                <RSelect value={f.office_code} onChange={(e) => setF({ office_code: e.target.value })} className="w-full">
                  <option value="">—</option>
                  {meta?.divisions.map((d) => (
                    <optgroup key={d.code} label={d.label_mr}>{d.offices.map((o) => <option key={o.code} value={o.code}>{name(o)}</option>)}</optgroup>
                  ))}
                </RSelect>
              </RLabel>
            )}
          </div>
        )}
      </RSheet>

      <RSheet open={!!secrets} onClose={() => setSecrets(null)} wide closeLabel={t("saved_close")}
        title={secrets?.bulk ? tf("n_accounts_created", { n: secrets.rows.length }) : t("temp_password_title")}
        description={t("temp_password_sub")}
        footer={<div className="flex flex-wrap justify-end gap-2.5">
          <RButton onClick={() => setSecrets(null)}><Check aria-hidden /> {t("saved_close")}</RButton>
          <RButton variant="pri" onClick={() => secrets && downloadCsv(secrets.rows)}><Download aria-hidden /> {t("download_csv")}</RButton>
        </div>}>
        <RAlert tone="returned" title={t("shown_once")}>{t("shown_once_sub")}</RAlert>
        <div className="max-h-[300px] overflow-auto rounded-[10px] border border-r-sunk bg-r-card">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>{[t("username"), t("for_whom"), t("temp_password")].map((h) => <th key={h} scope="col" className="sticky top-0 border-b-[1.5px] border-r-ink bg-r-card px-3 py-2 text-left text-xs text-r-muted">{h}</th>)}</tr>
            </thead>
            <tbody>
              {secrets?.rows.map((u) => (
                <tr key={u.id} className="border-b border-r-sunk">
                  <td className="num h-[38px] px-3">{u.username}</td>
                  <td className="px-3">{u.role === "zone" ? divName(u.division_code) : officeName(u.office_code) || u.display_name}</td>
                  <td className="num px-3 font-semibold tracking-[0.04em]">{u.temp_password}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </RSheet>
    </RPage>
  );
}
