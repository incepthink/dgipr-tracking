export type Tone = "success" | "warning" | "danger" | "neutral" | "info";

const TONES: Record<string, Tone> = {
  complete: "success", completed: "success", include: "success", match: "success", final: "success",
  auto: "success", confirmed: "success", countable: "success", intact: "success", configured: "success",
  partial: "warning", pending: "warning", needs_review: "warning", insufficient_text: "warning", draft: "warning",
  unconfirmed: "warning", warning: "warning", fixture: "warning",
  manual: "info", running: "info", queued: "info",
  failed: "danger", interrupted: "danger", exclude: "danger", missing: "danger", blocker: "danger",
  modified: "danger", MISSING: "danger",
  no_match: "neutral", confirmed_zero: "neutral", skipped: "neutral", superseded: "neutral",
};

export function toneOf(status: string): Tone {
  return TONES[status] ?? "neutral";
}

const LABELS: Record<string, string> = {
  needs_review: "Needs review", insufficient_text: "Too little text", no_match: "No match", match: "Match",
  include: "Included", exclude: "Excluded", pending: "Awaiting decision", confirmed_zero: "Confirmed 0",
  completed: "Completed", complete: "Complete", running: "Running", queued: "Queued", partial: "Partial",
  failed: "Failed", interrupted: "Interrupted", draft: "Draft", final: "Final", skipped: "Skipped",
  blocker: "Blocker", warning: "Warning", collection_incomplete: "Collection incomplete",
  pending_review: "Pending review", mapping_unconfirmed: "Mapping unconfirmed", missing_input: "Missing input",
  missing_days: "Days not entered", collected_differs: "Collected count differs", entered: "Submitted",
  account_unmapped: "Account unmapped", task_failed: "Task failed", video_bite: "Video bite",
  video_interview: "Video interview", manual: "Manual", auto: "Auto", missing: "Missing",
};

export function labelOf(status: string) {
  return LABELS[status] ?? status.replace(/_/g, " ");
}

export const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", x: "X", youtube: "YouTube",
};
