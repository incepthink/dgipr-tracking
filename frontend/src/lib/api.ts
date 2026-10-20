export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Fired when the server answers 401 (session missing or expired); AuthGate listens and shows the login page. */
export const UNAUTHORIZED_EVENT = "dgipr:unauthorized";

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !url.startsWith("/api/auth/")) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail))
        msg = j.detail.map((d: { loc?: unknown[]; msg: string }) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg}`).join("; ");
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>("PUT", url, body),
  patch: <T>(url: string, body: unknown) => request<T>("PATCH", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
};

// --------------------------------------------------------------------------- types
export interface OfficeRef { code: string; name_mr: string; name_en: string; kind?: string }
export interface Division { code: string; label_mr: string; offices: OfficeRef[] }
export interface Provider { platform: string; provider: string; credentials: string }
export interface CampaignBrief { id: number; slug: string; title_mr: string; title_en: string; active: boolean; version: number }
export interface Column { key: string; label_mr: string; label_en: string; source: string; group: "print" | "video" | "social" | "other" }

export interface Meta {
  operator: string;
  default_day: string;
  /** State users only (Social Monitoring). */
  platforms?: string[];
  /** Latest day every active account already has from live collections (no re-fetch needed). */
  covered_day?: string | null;
  overlap_hours?: number;
  providers?: Provider[];
  campaigns: CampaignBrief[];
  columns: Column[];
  divisions: Division[];
}

export interface Account {
  id: number; platform: string; handle: string; url: string; display_name: string;
  office_code: string | null; office: OfficeRef | null; mapping_confirmed: boolean;
  mapping_note: string; active: boolean; external_id: string | null;
}

export interface RunBrief {
  id: number; campaign_id: number | null; period_start: string; period_end: string; status: string;
  mode: string; triggered_by: string; created_at: string; tasks: number;
}

export interface SnapBrief {
  id: number; campaign_id: number | null; period_start: string; period_end: string; kind: string; is_sample: boolean;
  created_by: string; created_at: string; note: string; superseded_by_id: number | null;
}

export interface Dashboard {
  runs: RunBrief[];
  snapshots: SnapBrief[];
  stats: { publications: number; accounts: number; unconfirmed: number; pending_review_day: number; day: string };
}

export interface Task {
  id: number; platform: string; handle: string; provider: string; status: string;
  window_complete: boolean | null; coverage_note: string; pages: number; received: number; in_window: number;
  new: number; updated: number; unparseable: number; requests: number; usage: Record<string, unknown>;
  progress: string; error_kind: string | null; error: string | null;
}

export interface RunDetail {
  id: number; status: string; active: boolean; campaign_id: number | null; period_start: string; period_end: string;
  window_start_utc: string; window_end_utc: string; overlap_hours: number; mode: string; triggered_by: string;
  trigger_source: string; created_at: string; started_at: string; finished_at: string; tasks: Task[];
}

export interface Match { term: string; kind: string; lang: string; field: string; start: number; end: number; snippet: string }

export interface Cls {
  id: number; campaign_id: number; auto_decision: string; auto_score: number;
  auto_evidence: { matches?: Match[]; reasons?: string[] }; classifier: string; classifier_version: string;
  rules_version: number; manual_decision: string | null; manual_note: string; manual_by: string | null;
  manual_at: string | null; report_tag: string | null; effective_decision: string;
}

export interface PubBrief {
  id: number; platform: string; platform_post_id: string; provider: string; url: string; published_at: string;
  reporting_date: string; content_type: string; is_repost: boolean; is_reply: boolean; is_quote: boolean;
  is_pinned: boolean | null; is_short: boolean | null; media_count: number;
  account: { id: number; handle: string; platform: string }; office: OfficeRef | null;
}

export interface ReviewRow {
  pub: PubBrief; cls: Cls | null; eff: string; counts: boolean; count_reason: string;
  highlight: Record<string, [string, boolean][]>;
}

export interface ReviewData {
  campaign: CampaignBrief | null; start: string; end: string;
  summary: { total: number; pending: number; include: number };
  rows: ReviewRow[];
}

export interface AuditRow {
  id: number; at: string; actor: string; action: string; entity_type: string; entity_id: string;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null; note: string;
}

export interface Publication extends PubBrief {
  published_at_utc: string; title: string; text: string; description: string;
  media: { kind?: string; url?: string }[]; metrics: Record<string, number | null>; metrics_observed_at: string;
  attributes: Record<string, unknown>; first_collected_at: string; last_collected_at: string;
  first_run_id: number | null; last_run_id: number | null;
  provenance: { run_id?: number; task_id?: number; provider?: string; raw_id?: number; fetched_at?: string }[];
  classifications: Cls[]; history: AuditRow[];
  raw: { provider: string; fetched_at: string; sha256: string; payload: unknown } | null;
}

export interface Cell {
  value: number | null; state: "entered" | "auto" | "manual" | "confirmed_zero" | "missing"; complete: boolean;
  issues: string[]; publication_ids: number[]; manual: { by: string; at: string; note: string } | null; source: string;
  days_entered?: number;
  /** Count from collected publications, kept as a cross-check when the value comes from office entries. */
  collected?: { value: number; complete: boolean; issues: string[] };
}
export interface Agg { value: number; known: number; complete: boolean }
export interface Issue {
  severity: "blocker" | "warning"; code: string; office: string | null; office_name?: string;
  column: string | null; message: string;
}
export interface ReportOffice { code: string; name_mr: string; name_en: string; kind: string; cells: Record<string, Cell> }
export interface ReportData {
  source?: "office_entries" | "legacy";
  campaign: { id: number | null; title_mr: string; rules_version: number | null };
  period: { start: string; end: string };
  columns: (Column & { header_lines: string[] })[];
  divisions: {
    code: string; summary_label_mr: string; section_title_mr: string;
    offices: ReportOffice[];
    subtotal: Record<string, Agg>;
  }[];
  grand_total: Record<string, Agg>;
  issues: Issue[];
  complete: boolean;
  accounts: { id: number; platform: string; handle: string; office: string | null; mapping_confirmed: boolean; period_covered: boolean }[];
  presentation: { summary_title: string; generated_at_ist?: string };
}

export interface ReportResponse {
  campaign: CampaignBrief | null; start: string; end: string; data: ReportData; snapshots: SnapBrief[];
}

export interface SnapshotDetail extends SnapBrief {
  data_sha256: string; pdf_sha256: string | null; intact: boolean; data: ReportData;
}

export interface CampaignFull extends CampaignBrief {
  updated_at: string; updated_by: string; rules_yaml: string; count_yaml: string;
}

export interface TestResult { decision: string; score: number; reasons: string[]; evidence: Match[] }

// --------------------------------------------------------------------------- auth / office reports
export type Role = "district" | "zone" | "state";

export interface Me {
  id: number; username: string; display_name: string; role: Role;
  office: OfficeRef | null; division: { code: string; label_mr: string } | null;
  must_change_password: boolean; editable_offices: string[];
}

// --------------------------------------------------------------------------- report forms
export type FieldType = "number" | "text" | "yesno" | "choice" | "date";
export type Frequency = "daily" | "weekly" | "once";
export type FormStatus = "draft" | "published" | "closed" | "archived";
export type SubStatus = "none" | "draft" | "submitted" | "returned" | "accepted";

export interface FormField {
  id: number | null; key: string; label_mr: string; label_en: string; help_mr: string; help_en: string;
  type: FieldType; required: boolean; options: string[]; min_value: number | null; max_value: number | null;
  integer: boolean; group: string; sort_order?: number; aggregate: "sum" | "none"; archived: boolean; locked: boolean;
}

export interface FormDef {
  id: number; slug: string; title_mr: string; title_en: string; instructions_mr: string; instructions_en: string;
  frequency: Frequency; start_date: string; end_date: string | null; deadline_hours: number | null;
  status: FormStatus; entry_open: boolean; campaign_id: number | null; created_by: string; created_at: string;
  updated_at: string; recipients: string[]; schedule_locked: boolean; fields?: FormField[];
}

/** Admin list card. */
export interface FormBrief extends FormDef {
  fields_count: number; latest_period: string | null; latest_sent: number; latest_expected: number; latest_deadline: string | null;
}

/** Office inbox entry. */
export interface InboxForm {
  id: number; slug: string; title_mr: string; title_en: string; instructions_mr: string; instructions_en: string;
  frequency: Frequency; status: FormStatus; entry_open: boolean; start_date: string; end_date: string | null;
  offices: string[]; pending: number; overdue: number; returned: number; first_pending: string | null;
  latest_period: string | null; latest_deadline: string | null;
}

export type AnswerValue = number | string | null;
export interface Correction { original: AnswerValue; by: string; at: string; note: string }

export interface Submission {
  form_id: number; office: string; period_start: string; period_end: string; label: string; status: SubStatus;
  late: boolean; deadline: string | null; submitted_at: string | null; submitted_by: string; reviewed_at: string | null;
  reviewed_by: string; review_note: string; note: string; values: Record<string, AnswerValue>;
  corrections: Record<string, Correction>; entered_by: string | null; entered_at: string | null;
  read_only_reason?: string | null;
}

export interface PeriodsResponse {
  form: FormDef; office: string; start: string; end: string; editable_offices: string[]; periods: Submission[];
}

export interface ResponseRow extends Submission {
  office_name_mr: string; office_name_en: string; division: string; division_mr: string;
}
export interface ResponsesData { form: FormDef; start: string; end: string; can_review: boolean; periods: string[]; rows: ResponseRow[] }

export interface ComplianceCell { status: SubStatus; late: boolean; filled: number }
export interface ComplianceRow {
  code: string; name_mr: string; name_en: string; division: string; division_mr: string;
  cells: ComplianceCell[]; sent: number; pct: number;
}
export interface Compliance {
  start: string; end: string; periods: string[]; of: number; rows: ComplianceRow[];
  counts: Partial<Record<SubStatus, number>>[]; missing: string[][];
}

export interface Coverage { filled_cells: number; expected_cells: number; pct: number; offices: number; offices_reporting: number; days: number }
export interface Summary {
  start: string; end: string; totals: Record<string, number>; coverage: Coverage;
  previous: { start: string; end: string; totals: Record<string, number> };
}
export interface BreakdownRow {
  code: string; name_mr: string; name_en: string; kind?: string; division?: string; division_mr?: string;
  values: Record<string, number>; filled_cells: number; expected_cells: number; offices?: number;
}
export interface Breakdown { level: "office" | "division"; start: string; end: string; rows: BreakdownRow[]; total: Record<string, number> }
export interface SeriesPoint { date: string; label: string; values: Record<string, number>; entered?: Record<string, number>; entered_cells: number; expected_cells: number }
export interface Rankings {
  column: string; level: string; total: number;
  rows: { code: string; name_mr: string; name_en: string; division_mr?: string | null; value: number; share: number }[];
}
export interface SheetTable {
  kind: string; title: string; subtitle: string; start: string; end: string;
  header: string[]; rows: (string | number)[][]; total: (string | number)[]; text_cols: number;
  /** blank[i][j]: nothing at all was entered behind value cell (i, j) — shown as not reported, not 0. */
  blank?: boolean[][];
}

// --------------------------------------------------------------------------- insights (docs/analytics.md)
export interface AttentionItem {
  kind: "missing" | "streak" | "spike" | "repeat" | "correction"; office: string; name_mr: string; name_en: string;
  division_mr: string; date: string; field: string | null; value: number | null; expected: number | null; link: string;
  status?: SubStatus; since?: string; ever?: boolean; ratio?: number | null; previous?: string; by?: string; note?: string;
}
export interface Attention {
  period: string | null; offices: number; sent: number; missing: AttentionItem[]; streaks: AttentionItem[];
  spikes: AttentionItem[]; repeats: AttentionItem[]; corrections: AttentionItem[];
}
export type GroupKey = "print" | "video" | "social" | "other";
export interface GroupRow {
  key: GroupKey; fields: string[]; total: number; previous: number; delta_pct: number | null;
  series: { date: string; value: number; reported: boolean }[];
}
export interface Groups { start: string; end: string; previous: { start: string; end: string }; comparable: boolean; groups: GroupRow[] }
export interface MapRow {
  code: string; name_mr: string; name_en: string; kind: string; division: string; division_mr: string;
  due: number; sent: number; pct: number | null; total: number; entered: number; per_day: number | null;
  series: (number | null)[]; previous: number | null; previous_per_day: number | null; delta_pct: number | null;
  latest: SubStatus; latest_reported: boolean;
}
export interface OfficeMap {
  start: string; end: string; periods: string[]; latest: string | null; column: string; group: string;
  fields: string[]; comparable: boolean; rows: MapRow[];
}
export interface MoverRow {
  code: string; name_mr: string; name_en: string; division_mr: string; due: number; sent: number; total: number;
  per_day: number | null; share_reported: number | null; previous_per_day?: number; change?: number; delta_pct?: number | null;
}
export interface Movers {
  start: string; end: string; level: "office" | "division"; comparable: boolean; previous: { start: string; end: string };
  top: MoverRow[]; improved: MoverRow[]; eligible_share: number;
}
export interface HeatCell extends ComplianceCell { total: number | null; due: boolean }
export interface Heatmap extends Omit<Compliance, "rows"> {
  column: string; rows: (Omit<ComplianceRow, "cells"> & { cells: HeatCell[] })[];
}
export interface Peer { offices: number; periods_reported: number; per_day: Record<string, number | null> }
export interface Brief {
  period: string | null; text: string; source: "ai" | "template" | "none"; reason?: string; created_at?: string;
  ai_configured: boolean;
}
export interface AskSuggestion { mr: string; en: string; intent: string; params: Record<string, unknown> }
export interface AskColumn { key: string; label_mr: string; label_en: string; num: boolean }
export interface AskAnswer {
  intent: string; params?: Record<string, unknown>; question?: string; start?: string; end?: string; reason?: string;
  kind?: "table" | "series"; columns?: AskColumn[]; rows?: Record<string, string | number | null>[];
  points?: { date: string; value: number; reported: boolean }[]; summary?: { sent: number; offices: number };
  suggestions?: AskSuggestion[]; comparable?: boolean;
}

export interface UserRow {
  id: number; username: string; display_name: string; role: Role; office_code: string | null;
  division_code: string | null; active: boolean; must_change_password: boolean; created_at: string;
  last_login_at: string | null; temp_password?: string;
}
