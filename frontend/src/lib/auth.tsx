import * as React from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, UNAUTHORIZED_EVENT, type Me, type Role } from "./api";
import LoginPage, { ChangePasswordPage } from "@/pages/Login";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/api/auth/me"),
    retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 1,
    staleTime: 5 * 60_000,
  });
}

/** The logged-in user; only call below AuthGate. */
export function useUser(): Me {
  const { data } = useMe();
  if (!data) throw new Error("useUser outside AuthGate");
  return data;
}

/** Shows the login page until there is a session, then the forced password change, then the app. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { data, error, isLoading } = useMe();
  React.useEffect(() => {
    const onUnauthorized = () => { try { sessionStorage.setItem("signed_out", "1"); } catch { /* storage unavailable */ } qc.setQueryData(["me"], null); qc.invalidateQueries({ queryKey: ["me"] }); };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [qc]);

  if (isLoading) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">…</div>;
  if (!data || (error instanceof ApiError && error.status === 401)) return <LoginPage />;
  if (data.must_change_password) return <ChangePasswordPage me={data} />;
  return <>{children}</>;
}

/** Renders children only for the given roles; others are sent home. */
export function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const me = useUser();
  return roles.includes(me.role) ? <>{children}</> : <Navigate to="/" replace />;
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    try { await api.post("/api/auth/logout"); } finally {
      qc.clear();
      qc.setQueryData(["me"], null);
      window.location.assign("/app/");
    }
  };
}
