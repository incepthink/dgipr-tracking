import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, ChevronRight, ClipboardCheck, DownloadCloud, FileBarChart2, FileText, Newspaper, PlugZap, Users, UserX,
} from "lucide-react";
import { api, type Dashboard } from "@/lib/api";
import { useMeta } from "@/lib/hooks";
import { dmyText, fmtDate, periodLabel, qs } from "@/lib/utils";
import { PLATFORM_LABEL } from "@/lib/status";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, StatusBadge, Skeleton } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Callout, EmptyState, ErrorState, PageHeader, PlatformIcon, StatCard } from "@/components/common";

export default function DashboardPage() {
  const { data: meta } = useMeta();
  const { data, isLoading, error } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/api/dashboard") });
  const day = data?.stats.day ?? meta?.default_day ?? "";
  const carry = qs({ start: day, end: day });
  const fixtures = meta?.providers?.filter((p) => p.provider.startsWith("fixture")) ?? [];
  const missing = meta?.providers?.filter((p) => p.credentials === "MISSING") ?? [];

  const steps = [
    { n: 1, to: "/collect", icon: DownloadCloud, title: "Collect publications", text: "Pick the reporting day and accounts, then fetch posts from each platform." },
    { n: 2, to: "/review", icon: ClipboardCheck, title: "Review matches", text: "Confirm which posts belong to the campaign. Highlighted keywords show why." },
    { n: 3, to: "/report", icon: FileBarChart2, title: "Fill & approve report", text: "Enter the manual columns, preview the PDF, then approve the final report." },
  ];

  if (error) return <ErrorState error={error} />;

  return (
    <>
      <PageHeader
        title="Welcome"
        description={<>Reporting day defaults to <b className="text-foreground">{day ? fmtDate(day) : "…"}</b> (yesterday, IST). Follow the three steps below to produce the daily publicity report.</>}
        actions={<Button asChild><Link to={`/collect${carry}`}>Start today's report <ArrowRight /></Link></Button>}
      />

      {(fixtures.length > 0 || missing.length > 0) && (
        <div className="mb-6 space-y-3">
          {missing.length > 0 && (
            <Callout tone="danger" title="Provider credentials missing">
              {missing.map((p) => PLATFORM_LABEL[p.platform] ?? p.platform).join(", ")} cannot be collected until credentials are configured in <code>.env</code>.
            </Callout>
          )}
          {fixtures.length > 0 && (
            <Callout tone="warning" title="Sample data mode">
              {fixtures.map((p) => PLATFORM_LABEL[p.platform] ?? p.platform).join(", ")} use synthetic fixtures — collected items are sample data, not live publications.
            </Callout>
          )}
        </div>
      )}

      <ol className="mb-8 grid gap-4 md:grid-cols-3 md:gap-6">
        {steps.map((s, i) => (
          <li key={s.n} className="relative">
            {i < steps.length - 1 && (
              <div aria-hidden className="absolute top-1/2 -right-4.75 z-10 hidden size-7 -translate-y-1/2 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs md:flex">
                <ChevronRight className="size-4" />
              </div>
            )}
            <Link to={s.to + carry} className="group block h-full rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <Card className="relative flex h-full flex-col overflow-hidden p-5 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-lg">
                <div className="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-linear-to-r from-primary to-primary/40 transition-transform duration-300 group-hover:scale-x-100" />
                <div className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-primary/5 transition-colors group-hover:bg-primary/10" />

                <div className="relative flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground ring-4 ring-primary/15">
                      {s.n}
                    </span>
                    <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                      Step {s.n} of {steps.length}
                    </span>
                  </div>
                  <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <s.icon className="size-5" />
                  </div>
                </div>

                <div className="relative mt-5 flex-1">
                  <div className="text-base font-semibold tracking-tight">{s.title}</div>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
                </div>

                <div className="relative mt-5 flex items-center justify-between border-t pt-4 text-sm font-medium">
                  <span className="text-foreground/80 transition-colors group-hover:text-primary">Open step</span>
                  <span className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:bg-primary group-hover:text-primary-foreground">
                    <ArrowRight className="size-3.5" />
                  </span>
                </div>
              </Card>
            </Link>
          </li>
        ))}
      </ol>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {isLoading || !data ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-26 rounded-xl" />)
        ) : (
          <>
            <StatCard label="Publications stored" value={data.stats.publications.toLocaleString("en-IN")} icon={Newspaper} />
            <StatCard label="Active accounts" value={data.stats.accounts} icon={Users} to="/accounts" />
            <StatCard label="Unconfirmed mappings" value={data.stats.unconfirmed} icon={UserX}
              tone={data.stats.unconfirmed ? "danger" : "success"} to="/accounts" />
          </>
        )}
      </div>

      <div>
        <Card>
          <CardHeader>
            <CardTitle>Report snapshots</CardTitle>
            <CardDescription>Frozen drafts and approved finals</CardDescription>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            {data?.snapshots.length === 0 ? (
              <EmptyState icon={FileText} title="No reports yet">Approve a report in step 3 to see it here.</EmptyState>
            ) : (
              <ul className="divide-y">
                {data?.snapshots.map((s) => (
                  <li key={s.id}>
                    <Link to={`/reports/${s.id}`} className="flex items-center gap-4 rounded-lg px-3 py-3 transition-colors hover:bg-accent/60">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-muted"><FileText className="size-4 text-muted-foreground" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{periodLabel(s.period_start, s.period_end)}</div>
                        <div className="truncate text-xs text-muted-foreground">#{s.id} · {s.created_by} · {dmyText(s.created_at)}</div>
                      </div>
                      <div className="flex gap-1.5">
                        {s.is_sample && <Badge tone="warning">Sample</Badge>}
                        {s.superseded_by_id && <Badge>Superseded</Badge>}
                        <StatusBadge status={s.kind} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><PlugZap className="size-4" /> Data providers</CardTitle>
          <CardDescription>Which service collects each platform</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {meta?.providers?.map((p) => (
            <div key={p.platform} className="flex items-center gap-3 rounded-lg border p-3">
              <PlatformIcon platform={p.platform} className="size-8 text-xs" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{PLATFORM_LABEL[p.platform] ?? p.platform}</div>
                <div className="truncate text-xs text-muted-foreground" title={p.provider}>{p.provider}</div>
              </div>
              <StatusBadge
                status={p.credentials === "MISSING" ? "failed" : p.provider.startsWith("fixture") ? "draft" : "complete"}
                label={p.credentials === "MISSING" ? "Missing" : p.provider.startsWith("fixture") ? "Sample" : "Ready"}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
