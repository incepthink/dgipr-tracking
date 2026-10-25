import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider, useLocation, useParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "./index.css";
import { Layout } from "@/components/Layout";
import { TooltipProvider } from "@/components/ui/primitives";
import MonitorPage from "@/pages/monitor/Monitor";
import RunsPage from "@/pages/Runs";
import PublicationPage from "@/pages/Publication";
import SnapshotPage from "@/pages/Snapshot";
import AccountsPage from "@/pages/Accounts";
import CampaignPage from "@/pages/Campaign";
import AuditPage from "@/pages/Audit";
import MyFormsPage from "@/pages/forms/MyForms";
import FillFormPage from "@/pages/forms/FillForm";
import FormsListPage from "@/pages/forms/FormsList";
import FormBuilderPage from "@/pages/forms/FormBuilder";
import ResponsesPage from "@/pages/forms/Responses";
import AnalyticsPage, { FormAnalyticsPage } from "@/pages/office/Analytics";
import InsightsOverview from "@/pages/insights/Overview";
import InsightsPosts from "@/pages/insights/Posts";
import InsightsPost from "@/pages/insights/Post";
import InsightsDistricts from "@/pages/insights/Districts";
import DeskPage from "@/pages/office/Desk";
import CompliancePage from "@/pages/office/Compliance";
import ZoneBoardPage from "@/pages/office/ZoneBoard";
import AccountPage from "@/pages/Account";
import OfficeReportsPage from "@/pages/office/Reports";
import UsersPage from "@/pages/admin/Users";
import { AuthGate, RequireRole, useUser } from "@/lib/auth";
import { LangProvider } from "@/lib/i18n";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

/** Social Monitoring and administration are for the state admin only (the API enforces the same). */
const state = (el: React.ReactNode) => <RequireRole roles={["state"]}>{el}</RequireRole>;
/** Insights (post analytics) and the form analytics are for the state and zone offices. */
const insights = (el: React.ReactNode) => <RequireRole roles={["state", "zone"]}>{el}</RequireRole>;

function Home() {
  const me = useUser();
  return <Navigate to={me.role === "state" ? "/monitor" : me.role === "zone" ? "/office/board" : "/forms/mine"} replace />;
}

/** The old collect / review / report pages now live on the one Monitoring page; keep their links working. */
function ToMonitor({ step }: { step?: "review" | "report" }) {
  const { search } = useLocation();
  const p = new URLSearchParams(search);
  if (step) p.set("step", step);
  return <Navigate to={`/monitor${p.size ? `?${p}` : ""}`} replace />;
}

function RunToMonitor() {
  const { id } = useParams();
  return <Navigate to={`/monitor?run=${id}`} replace />;
}

const router = createBrowserRouter(
  [
    {
      element: <AuthGate><Layout /></AuthGate>,
      children: [
        { index: true, element: <Home /> },
        { path: "forms/mine", element: <MyFormsPage /> },
        { path: "forms/:id/fill", element: <FillFormPage /> },
        { path: "forms", element: state(<FormsListPage />) },
        { path: "forms/new", element: state(<FormBuilderPage />) },
        { path: "forms/:id/edit", element: state(<FormBuilderPage />) },
        { path: "forms/responses", element: <ResponsesPage /> },
        { path: "office/entry", element: <Navigate to="/forms/mine" replace /> },
        { path: "office/analytics", element: <AnalyticsPage /> },
        { path: "office/form-analytics", element: insights(<FormAnalyticsPage />) },
        { path: "insights", element: insights(<InsightsOverview />) },
        { path: "insights/posts", element: insights(<InsightsPosts />) },
        { path: "insights/posts/:id", element: insights(<InsightsPost />) },
        { path: "insights/districts", element: insights(<InsightsDistricts />) },
        { path: "office/desk", element: state(<DeskPage />) },
        { path: "office/compliance", element: <RequireRole roles={["zone"]}><CompliancePage /></RequireRole> },
        { path: "office/board", element: <RequireRole roles={["zone"]}><ZoneBoardPage /></RequireRole> },
        { path: "account", element: <AccountPage /> },
        { path: "office/reports", element: <OfficeReportsPage /> },
        { path: "monitor", element: state(<MonitorPage />) },
        { path: "collect", element: <ToMonitor /> },
        { path: "runs", element: state(<RunsPage />) },
        { path: "runs/:id", element: <RunToMonitor /> },
        { path: "review", element: <ToMonitor step="review" /> },
        { path: "publications/:id", element: state(<PublicationPage />) },
        { path: "report", element: <ToMonitor step="report" /> },
        { path: "reports/:id", element: state(<SnapshotPage />) },
        { path: "accounts", element: state(<AccountsPage />) },
        { path: "campaigns", element: state(<CampaignPage />) },
        { path: "campaigns/:id", element: state(<CampaignPage />) },
        { path: "audit", element: state(<AuditPage />) },
        { path: "admin/users", element: state(<UsersPage />) },
        { path: "*", element: <Navigate to="/" replace /> },
      ],
    },
  ],
  { basename: "/app" },
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <LangProvider>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster richColors position="bottom-right" closeButton />
      </TooltipProvider>
      </LangProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
