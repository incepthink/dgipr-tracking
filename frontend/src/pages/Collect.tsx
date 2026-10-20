import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Info, RefreshCw, Rewind, Search, UserX } from "lucide-react";
import { api, type Account } from "@/lib/api";
import { useAction, useMeta, usePeriod } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { PLATFORM_LABEL } from "@/lib/status";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Field, Input, Tip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Callout, EmptyState, LoadingRows, PageHeader, PeriodPicker, PlatformIcon } from "@/components/common";

export default function CollectPage() {
  const { data: meta } = useMeta();
  // Default to the latest day already collected live, so a default incremental run makes no provider calls.
  const period = usePeriod(meta?.covered_day ?? undefined);
  // Search term is optional and starts empty — only an explicit pick in the URL counts, no active-campaign fallback.
  const campaignId = Number(period.params.get("campaign_id")) || 0;
  const navigate = useNavigate();
  const { data: accounts, isLoading } = useQuery({
    queryKey: ["collect-accounts"], queryFn: () => api.get<Account[]>("/api/collect/accounts"),
  });
  const [selected, setSelected] = React.useState<Set<number> | null>(null);
  const [mode, setMode] = React.useState<"window" | "incremental">("incremental");
  const [overlap, setOverlap] = React.useState<number | "">("");
  const [filter, setFilter] = React.useState("");

  const sel = selected ?? new Set(accounts?.map((a) => a.id) ?? []);
  const toggle = (id: number) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const groups = React.useMemo(() => {
    const f = filter.trim().toLowerCase();
    const out: Record<string, Account[]> = {};
    for (const a of accounts ?? []) {
      if (f && !`${a.handle} ${a.display_name} ${a.office?.name_mr ?? ""} ${a.office?.name_en ?? ""}`.toLowerCase().includes(f)) continue;
      (out[a.platform] ??= []).push(a);
    }
    return out;
  }, [accounts, filter]);

  // That day is covered without the overlap margin, so it only stays call-free with overlap 0.
  const onCoveredDay = !!meta?.covered_day && period.start === meta.covered_day && period.end === meta.covered_day;
  const defaultOverlap = onCoveredDay ? 0 : meta?.overlap_hours ?? 6;

  const unconfirmed = accounts?.filter((a) => sel.has(a.id) && !a.mapping_confirmed).length ?? 0;

  const start = useAction(
    () => api.post<{ id: number }>("/api/runs", {
      campaign_id: campaignId || null, start: period.start, end: period.end, account_ids: [...sel],
      overlap_hours: overlap === "" ? (onCoveredDay ? 0 : null) : overlap, mode,
    }),
    { success: (r) => `Collection run #${r.id} started`, invalidate: [["dashboard"], ["runs"]], onSuccess: (r) => navigate(`/runs/${r.id}`) },
  );

  return (
    <>
      <PageHeader step={1} title="Collect publications"
        description="Choose the reporting period and the accounts to fetch. Re-running is safe — posts are keyed by platform and ID, so nothing is duplicated." />

      <div className="space-y-6">
        <PeriodPicker campaignId={campaignId} start={period.start} end={period.end} onChange={period.set} searchableCampaign />

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Accounts</CardTitle>
                <CardDescription>{sel.size} of {accounts?.length ?? 0} selected</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter accounts" className="w-48 pl-8" />
                </div>
                <Button variant="outline" size="sm" onClick={() => setSelected(new Set(accounts?.map((a) => a.id)))}>All</Button>
                <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>None</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {isLoading ? <LoadingRows /> : !accounts?.length ? (
                <EmptyState icon={UserX} title="No active accounts" action={<Button size="sm" asChild><Link to="/accounts">Register accounts</Link></Button>} />
              ) : Object.entries(groups).map(([platform, list]) => {
                const allOn = list.every((a) => sel.has(a.id));
                const someOn = list.some((a) => sel.has(a.id));
                return (
                  <div key={platform}>
                    <label className="mb-2 flex cursor-pointer items-center gap-2.5">
                      <Checkbox checked={allOn ? true : someOn ? "indeterminate" : false}
                        onCheckedChange={() => {
                          const next = new Set(sel);
                          list.forEach((a) => (allOn ? next.delete(a.id) : next.add(a.id)));
                          setSelected(next);
                        }} />
                      <PlatformIcon platform={platform} className="size-5 text-[10px]" />
                      <span className="text-sm font-semibold">{PLATFORM_LABEL[platform] ?? platform}</span>
                      <span className="text-xs text-muted-foreground">{list.length}</span>
                    </label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {list.map((a) => (
                        <label key={a.id}
                          className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50",
                            sel.has(a.id) && "border-primary/40 bg-primary/[0.04]")}>
                          <Checkbox checked={sel.has(a.id)} onCheckedChange={() => toggle(a.id)} className="mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{a.handle}</div>
                            <div className="truncate text-xs text-muted-foreground">{a.office ? a.office.name_mr : "Not mapped to an office"}</div>
                          </div>
                          {!a.mapping_confirmed && (
                            <Tip content="Office mapping not confirmed — a final report will be blocked until it is confirmed on the Accounts page.">
                              <Badge tone="warning">Unconfirmed</Badge>
                            </Tip>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <Card>
              <CardHeader><CardTitle>Collection mode</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {([
                  { v: "window", icon: RefreshCw, title: "Full window", text: "Re-fetch the whole period and refresh metrics." },
                  { v: "incremental", icon: Rewind, title: "Incremental", text: "Skip time already fully collected." },
                ] as const).map((m) => (
                  <button key={m.v} onClick={() => setMode(m.v)}
                    className={cn("flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors cursor-pointer",
                      mode === m.v ? "border-primary bg-primary/[0.05] ring-1 ring-primary/30" : "hover:bg-accent/50")}>
                    <m.icon className={cn("mt-0.5 size-4", mode === m.v ? "text-primary" : "text-muted-foreground")} />
                    <div>
                      <div className="text-sm font-medium">{m.title}</div>
                      <div className="text-xs text-muted-foreground">{m.text}</div>
                    </div>
                  </button>
                ))}
                <Field label="Overlap (hours)" className="pt-2"
                  hint="Widens the request on both sides so posts near midnight or indexed late aren't missed.">
                  <Input type="number" min={0} max={72} value={overlap} placeholder={String(defaultOverlap)}
                    onChange={(e) => setOverlap(e.target.value === "" ? "" : Number(e.target.value))} />
                </Field>
                {onCoveredDay && (
                  <p className="text-xs text-muted-foreground">
                    This day is already collected. Incremental mode with overlap 0 makes no provider calls.
                  </p>
                )}
              </CardContent>
            </Card>

            {unconfirmed > 0 && (
              <Callout tone="warning" title={`${unconfirmed} selected account${unconfirmed > 1 ? "s have" : " has"} an unconfirmed mapping`}>
                Collection works, but the final report stays blocked until mappings are confirmed.
              </Callout>
            )}

            <Button size="lg" className="w-full" loading={start.isPending} disabled={!sel.size} onClick={() => start.mutate(undefined)}>
              Start collection <ArrowRight />
            </Button>
            <p className="flex gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              You'll see live progress for each account. Failed tasks never count as zero — they block the final report until retried.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
