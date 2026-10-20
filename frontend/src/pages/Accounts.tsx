import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Plus, Search, Users } from "lucide-react";
import { api, type Account } from "@/lib/api";
import { useAction, useMeta } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { PLATFORM_LABEL } from "@/lib/status";
import { Badge, Card, Checkbox, Field, Input, Select, Switch, Tip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Callout, EmptyState, ErrorState, LoadingRows, OfficeSelect, PageHeader, PlatformIcon } from "@/components/common";

type Edit = { office_code: string; mapping_note: string; active: boolean; confirm_mapping: boolean };

function AccountRow({ a }: { a: Account }) {
  const init: Edit = { office_code: a.office_code ?? "", mapping_note: a.mapping_note, active: a.active, confirm_mapping: false };
  const [e, setE] = React.useState(init);
  React.useEffect(() => setE({ office_code: a.office_code ?? "", mapping_note: a.mapping_note, active: a.active, confirm_mapping: false }), [a]);
  const dirty = e.office_code !== init.office_code || e.mapping_note !== init.mapping_note || e.active !== init.active || e.confirm_mapping;
  const officeChanged = e.office_code !== (a.office_code ?? "");
  const save = useAction((body: Edit) => api.patch<Account>(`/api/accounts/${a.id}`, body), {
    success: `${a.handle} updated`, invalidate: [["accounts"], ["meta"], ["dashboard"], ["collect-accounts"]],
  });

  return (
    <tr className={cn("align-top transition-colors", dirty && "bg-primary/[0.03]", !a.active && "opacity-60")}>
      <td className="px-4 py-3">
        <div className="flex items-start gap-3">
          <PlatformIcon platform={a.platform} className="mt-0.5" />
          <div className="min-w-0">
            <a href={a.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-medium hover:text-primary">
              {a.handle} <ExternalLink className="size-3 text-muted-foreground" />
            </a>
            <div className="truncate text-xs text-muted-foreground">{a.display_name || PLATFORM_LABEL[a.platform]}</div>
            {a.external_id && <div className="truncate font-mono text-[11px] text-muted-foreground">{a.external_id}</div>}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <OfficeSelect value={e.office_code} onChange={(v) => setE({ ...e, office_code: v, confirm_mapping: false })} className="min-w-56" />
        {officeChanged && a.office_code && <div className="mt-1 text-[11px] text-warning">Changing the office resets confirmation and re-maps stored posts.</div>}
      </td>
      <td className="px-4 py-3">
        {a.mapping_confirmed && !officeChanged ? (
          <Badge tone="success"><CheckCircle2 className="size-3" /> Confirmed</Badge>
        ) : (
          <label className={cn("flex items-center gap-2 text-sm", !e.office_code && "opacity-50")}>
            <Checkbox checked={e.confirm_mapping} disabled={!e.office_code} onCheckedChange={(v) => setE({ ...e, confirm_mapping: v === true })} />
            Confirm
          </label>
        )}
      </td>
      <td className="px-4 py-3">
        <Input value={e.mapping_note} onChange={(ev) => setE({ ...e, mapping_note: ev.target.value })} placeholder="Source of mapping" className="min-w-48" />
      </td>
      <td className="px-4 py-3"><Switch checked={e.active} onCheckedChange={(v) => setE({ ...e, active: v })} className="mt-2" /></td>
      <td className="px-4 py-3 text-right">
        <Button size="sm" variant={dirty ? "default" : "ghost"} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(e)}>Save</Button>
      </td>
    </tr>
  );
}

function AddAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: meta } = useMeta();
  const empty = { platform: "facebook", handle: "", url: "", display_name: "", office_code: "", mapping_note: "" };
  const [f, setF] = React.useState(empty);
  const add = useAction((body: typeof empty) => api.post<Account>("/api/accounts", body), {
    success: (a) => `${a.handle} registered`, invalidate: [["accounts"], ["collect-accounts"], ["dashboard"]],
    onSuccess: () => { setF(empty); onOpenChange(false); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Register an account</DialogTitle>
          <DialogDescription>Map it to the office whose report row it feeds. The mapping starts unconfirmed.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); add.mutate(f); }}>
          <Field label="Platform">
            <Select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>
              {meta?.platforms?.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p] ?? p}</option>)}
            </Select>
          </Field>
          <Field label="Handle"><Input required value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} placeholder="e.g. InfoPune" /></Field>
          <Field label="Profile URL" className="sm:col-span-2"><Input required type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://" /></Field>
          <Field label="Display name"><Input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
          <Field label="Office"><OfficeSelect value={f.office_code} onChange={(v) => setF({ ...f, office_code: v })} /></Field>
          <Field label="Mapping note" className="sm:col-span-2"><Input value={f.mapping_note} onChange={(e) => setF({ ...f, mapping_note: e.target.value })} placeholder="Where does this mapping come from?" /></Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={add.isPending}>Register account</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AccountsPage() {
  const { data: meta } = useMeta();
  const { data, isLoading, error } = useQuery({ queryKey: ["accounts"], queryFn: () => api.get<Account[]>("/api/accounts") });
  const [platform, setPlatform] = React.useState("");
  const [q, setQ] = React.useState("");
  const [onlyUnconfirmed, setOnlyUnconfirmed] = React.useState(false);
  const [adding, setAdding] = React.useState(false);

  const rows = (data ?? []).filter((a) =>
    (!platform || a.platform === platform) && (!onlyUnconfirmed || !a.mapping_confirmed) &&
    (!q || `${a.handle} ${a.display_name} ${a.office?.name_mr ?? ""} ${a.office?.name_en ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const unconfirmed = data?.filter((a) => a.active && !a.mapping_confirmed).length ?? 0;

  return (
    <>
      <PageHeader title="Accounts & office mapping"
        description="Each account feeds one office's row in the report. Mappings are set here explicitly — never guessed from post text — and a final report is blocked while any contributing mapping is unconfirmed."
        actions={<Button onClick={() => setAdding(true)}><Plus /> Add account</Button>} />

      {unconfirmed > 0 && (
        <Callout tone="warning" className="mb-4" title={`${unconfirmed} active account${unconfirmed === 1 ? "" : "s"} with unconfirmed mapping`}>
          Check the office, tick <b>Confirm</b> and save. <button className="font-medium text-primary hover:underline cursor-pointer" onClick={() => setOnlyUnconfirmed(true)}>Show only these</button>
        </Callout>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {["", ...(meta?.platforms ?? [])].map((p) => (
              <button key={p} onClick={() => setPlatform(p)}
                className={cn("flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-all cursor-pointer",
                  platform === p ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {p && <PlatformIcon platform={p} className="size-4 rounded text-[8px]" />}
                {p ? PLATFORM_LABEL[p] ?? p : "All"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={onlyUnconfirmed} onCheckedChange={(v) => setOnlyUnconfirmed(v === true)} /> Unconfirmed only
          </label>
          <div className="relative ml-auto">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search handle or office" className="w-60 pl-8" />
          </div>
        </div>
        {error ? <div className="p-5"><ErrorState error={error} /></div> : isLoading ? <LoadingRows /> : rows.length === 0 ? (
          <EmptyState icon={Users} title="No accounts match" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Account</th>
                  <th className="px-4 py-2.5 font-medium">Office (report row)</th>
                  <th className="px-4 py-2.5 font-medium">Mapping</th>
                  <th className="px-4 py-2.5 font-medium">Note</th>
                  <th className="px-4 py-2.5 font-medium"><Tip content="Inactive accounts are not collected"><span>Active</span></Tip></th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">{rows.map((a) => <AccountRow key={a.id} a={a} />)}</tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">Divisions and offices come from <code>config/organisation.yaml</code> (synced at start-up). Every change is recorded in the audit log.</p>
      <AddAccountDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}
