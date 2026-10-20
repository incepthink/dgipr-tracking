import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type Meta } from "./api";

export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: () => api.get<Meta>("/api/meta"), staleTime: 60_000 });
}

/** Campaign + reporting period kept in the URL, so every step (collect → review → report) shares it. */
export function usePeriod(defaultStart?: string) {
  const [params, setParams] = useSearchParams();
  const { data: meta } = useMeta();
  const defaultDay = defaultStart ?? meta?.default_day ?? "";
  const start = params.get("start") || defaultDay;
  const end = params.get("end") || start;
  const campaignId = Number(params.get("campaign_id")) || meta?.campaigns.find((c) => c.active)?.id || meta?.campaigns[0]?.id || 0;

  const set = useCallback(
    (patch: Record<string, string | number | null | undefined>) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === undefined || v === "") next.delete(k);
          else next.set(k, String(v));
        }
        return next;
      }, { replace: true });
    },
    [setParams],
  );

  return useMemo(() => ({ start, end, campaignId, ready: !!meta, params, set }), [start, end, campaignId, meta, params, set]);
}

/** Mutation helper: toasts on error/success and invalidates the given query keys. */
export function useAction<TVars, TRes>(
  fn: (vars: TVars) => Promise<TRes>,
  opts: { success?: string | ((r: TRes) => string); invalidate?: QueryKey[]; onSuccess?: (r: TRes, v: TVars) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      if (opts.success) toast.success(typeof opts.success === "function" ? opts.success(r) : opts.success);
      opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      opts.onSuccess?.(r, v);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
