import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DownloadCloud, Plus } from "lucide-react";
import { api, type RunBrief } from "@/lib/api";
import { periodLabel } from "@/lib/utils";
import { Card, StatusBadge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/common";

export default function RunsPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["runs"], queryFn: () => api.get<RunBrief[]>("/api/runs?limit=100") });
  return (
    <>
      <PageHeader title="Collection runs" description="Every fetch from the platforms, newest first."
        actions={<Button asChild><Link to="/monitor"><Plus /> New collection</Link></Button>} />
      {error ? <ErrorState error={error} /> : (
        <Card className="overflow-hidden">
          {isLoading ? <LoadingRows /> : !data?.length ? (
            <EmptyState icon={DownloadCloud} title="No collection runs yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-medium">Run</th>
                    <th className="px-5 py-3 font-medium">Reporting period</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Mode</th>
                    <th className="px-5 py-3 font-medium text-right">Tasks</th>
                    <th className="px-5 py-3 font-medium">Started by</th>
                    <th className="px-5 py-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.map((r) => (
                    <tr key={r.id} className="transition-colors hover:bg-accent/40">
                      <td className="px-5 py-3"><Link to={`/monitor?run=${r.id}`} className="font-medium text-primary hover:underline">#{r.id}</Link></td>
                      <td className="px-5 py-3">{periodLabel(r.period_start, r.period_end)}</td>
                      <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                      <td className="px-5 py-3 capitalize text-muted-foreground">{r.mode}</td>
                      <td className="px-5 py-3 text-right tabular">{r.tasks}</td>
                      <td className="px-5 py-3">{r.triggered_by || "—"}</td>
                      <td className="px-5 py-3 text-muted-foreground">{r.created_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
