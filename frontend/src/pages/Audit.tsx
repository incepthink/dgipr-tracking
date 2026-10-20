import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ScrollText, Search } from "lucide-react";
import { api, type AuditRow } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge, Card, Input, Select } from "@/components/ui/primitives";
import { EmptyState, ErrorState, JsonBlock, LoadingRows, PageHeader } from "@/components/common";

const tone = (action: string) =>
  action.startsWith("report.final") ? "success" : action.startsWith("report") ? "info"
    : action.includes("create") ? "info" : action.includes("clear") || action.includes("supersede") ? "warning" : "neutral";

function Diff({ before, after }: { before: AuditRow["before"]; after: AuditRow["after"] }) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const simple = keys.every((k) => typeof (before ?? {})[k] !== "object" && typeof (after ?? {})[k] !== "object");
  if (!simple) {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {before && <div><div className="mb-1 text-xs font-medium text-muted-foreground">Before</div><JsonBlock value={before} className="max-h-72" /></div>}
        {after && <div><div className="mb-1 text-xs font-medium text-muted-foreground">After</div><JsonBlock value={after} className="max-h-72" /></div>}
      </div>
    );
  }
  return (
    <table className="text-xs">
      <tbody>
        {keys.map((k) => {
          const b = before?.[k], a = after?.[k];
          const changed = JSON.stringify(b) !== JSON.stringify(a);
          return (
            <tr key={k}>
              <td className="py-0.5 pr-4 font-medium text-muted-foreground">{k}</td>
              {before && <td className={cn("py-0.5 pr-3", changed && "text-danger line-through")}>{b === undefined ? "" : String(b)}</td>}
              <td className={cn("py-0.5", changed && before && "font-medium text-success")}>{a === undefined ? "" : String(a)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function AuditPage() {
  const [limit, setLimit] = React.useState(300);
  const { data, isLoading, error } = useQuery({ queryKey: ["audit", limit], queryFn: () => api.get<AuditRow[]>(`/api/audit?limit=${limit}`) });
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState<Set<number>>(new Set());
  const rows = (data ?? []).filter((r) => !q || `${r.actor} ${r.action} ${r.entity_type} ${r.entity_id} ${r.note}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader title="Audit log" description="Every change made by an operator — collections, review decisions, manual values, mappings, rule edits and approvals." />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by operator, action, entity or note" className="pl-8" />
          </div>
          <Select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="w-40">
            {[100, 300, 1000, 2000].map((n) => <option key={n} value={n}>Last {n}</option>)}
          </Select>
        </div>
        {error ? <div className="p-5"><ErrorState error={error} /></div> : isLoading ? <LoadingRows rows={8} /> : rows.length === 0 ? (
          <EmptyState icon={ScrollText} title="No entries" />
        ) : (
          <ul className="divide-y">
            {rows.map((r) => {
              const isOpen = open.has(r.id);
              const hasDetail = !!(r.before || r.after);
              return (
                <li key={r.id}>
                  <button disabled={!hasDetail}
                    onClick={() => { const n = new Set(open); if (isOpen) n.delete(r.id); else n.add(r.id); setOpen(n); }}
                    className="flex w-full items-center gap-4 px-4 py-3 text-left text-sm transition-colors hover:bg-accent/40 disabled:cursor-default cursor-pointer">
                    <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90", !hasDetail && "invisible")} />
                    <span className="w-36 shrink-0 text-xs text-muted-foreground tabular">{r.at}</span>
                    <span className="w-32 shrink-0 truncate font-medium">{r.actor}</span>
                    <Badge tone={tone(r.action)} className="font-mono">{r.action}</Badge>
                    <span className="truncate text-muted-foreground">{r.entity_type} <span className="font-mono text-xs">{r.entity_id}</span></span>
                    {r.note && <span className="ml-auto hidden max-w-sm truncate text-xs text-muted-foreground italic md:block">“{r.note}”</span>}
                  </button>
                  {isOpen && (
                    <div className="border-t bg-muted/30 px-12 py-4">
                      {r.note && <p className="mb-2 text-sm italic">“{r.note}”</p>}
                      <Diff before={r.before} after={r.after} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
