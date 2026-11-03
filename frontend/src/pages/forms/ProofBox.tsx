import * as React from "react";
import { AlertCircle, Check, ExternalLink, FileText, Image as ImageIcon, Loader2, X } from "lucide-react";
import { api, ApiError, proofFileUrl, uploadFile, type FormField, type LinkCheck, type Proof } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RCheck, RTextarea } from "@/components/reports/kit";
import { dayMonth } from "@/components/reports/period";

/* The proof box beside a figure on the entry page (app/forms/proof.py): links pasted one per line, PDF/photo files
   uploaded straight to storage, or plain lists when the day is read-only. */

export type FileItem = {
  uid: string; key?: string; id?: number; name: string; type: string; size: number; sha256?: string;
  status: "uploading" | "done" | "error"; progress: number; error?: string;
};
export type ProofDraft = { linksText: string; files: FileItem[] };

export const FILE_TYPES = ["application/pdf", "image/jpeg", "image/png"];
export const MAX_FILE = 10 * 1024 * 1024;
const TRAIL = /[.,;:!?)\]}>"'。，、；：！？）」』】》]+$/;

/** The links in pasted text, in order, as the server reads them (app/forms/proof.py extract_links). */
export function parseLinks(text: string): string[] {
  return (text.match(/(?:https?:\/\/|www\.)[^\s<>"'`]+/gi) ?? [])
    .map((u) => u.replace(TRAIL, ""))
    .map((u) => (/^www\./i.test(u) ? `https://${u}` : u))
    .filter((u) => u.length > "https://".length);
}

export function proofDraftOf(proofs: Proof[] | undefined): ProofDraft {
  const list = proofs ?? [];
  return {
    linksText: list.filter((p) => p.kind === "link").map((p) => p.url).join("\n"),
    files: list.filter((p) => p.kind === "file").map((p) => ({
      uid: `p${p.id}`, id: p.id, key: p.key ?? undefined, name: p.name ?? "", type: p.type ?? "", size: p.size ?? 0,
      status: "done" as const, progress: 1,
    })),
  };
}

/** What would be saved: the links and the uploaded files' storage keys. */
const sig = (d: ProofDraft) => JSON.stringify([parseLinks(d.linksText), d.files.filter((f) => f.status === "done").map((f) => f.key)]);
export const sameProof = (a: ProofDraft | undefined, b: ProofDraft | undefined) => sig(a ?? EMPTY) === sig(b ?? EMPTY);
export const EMPTY: ProofDraft = { linksText: "", files: [] };

/** The `proofs` entry the save endpoint takes for one field: the whole list, saved and new files alike by key. */
export function proofPayload(d: ProofDraft) {
  return {
    links: parseLinks(d.linksText),
    files: d.files.filter((f) => f.status === "done" && f.key).map((f) => ({ key: f.key, name: f.name, type: f.type, size: f.size, sha256: f.sha256 })),
  };
}

export const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// --------------------------------------------------------------------------- uploads
/** Photos are re-encoded in the browser (longest side 2000 px, JPEG 0.8) before upload; PDFs go as they are. */
async function shrink(file: File): Promise<{ blob: Blob; type: string; name: string }> {
  if (!file.type.startsWith("image/")) return { blob: file, type: file.type, name: file.name };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    if (!blob || blob.size >= file.size) return { blob: file, type: file.type, name: file.name };
    return { blob, type: "image/jpeg", name: file.name.replace(/\.(png|jpe?g|heic)$/i, "") + ".jpg" };
  } catch {
    return { blob: file, type: file.type, name: file.name };
  }
}

async function sha256(blob: Blob) {
  try {
    const d = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined;  // crypto.subtle needs https or localhost
  }
}

let fileSeq = 0;

/** Uploads picked files one after another, reporting each item's state through `update`. Bad type or size is shown on the
 * item, never sent. */
export async function uploadPicked(files: File[], target: { formId: number; office: string; ps: string; field: string },
  add: (it: FileItem) => void, update: (uid: string, p: Partial<FileItem>) => void, t: (k: "file_too_big" | "file_bad_type" | "file_failed") => string) {
  for (const file of files) {
    const uid = `n${Date.now().toString(36)}_${++fileSeq}`;
    if (!FILE_TYPES.includes(file.type)) {
      add({ uid, name: file.name, type: file.type, size: file.size, status: "error", progress: 0, error: t("file_bad_type") });
      continue;
    }
    add({ uid, name: file.name, type: file.type, size: file.size, status: "uploading", progress: 0 });
    try {
      const { blob, type, name } = await shrink(file);
      if (blob.size > MAX_FILE) { update(uid, { status: "error", size: blob.size, error: t("file_too_big") }); continue; }
      update(uid, { name, type, size: blob.size });
      const up = await api.post<{ key: string; url: string; headers: Record<string, string> }>(
        `/api/forms/${target.formId}/submissions/${target.office}/${target.ps}/uploads`, { field: target.field, name, type, size: blob.size });
      await uploadFile(up.url, up.headers, blob, (p) => update(uid, { progress: p }));
      update(uid, { key: up.key, sha256: await sha256(blob), status: "done", progress: 1 });
    } catch (e) {
      update(uid, { status: "error", error: e instanceof ApiError && e.status ? e.message : t("file_failed") });
    }
  }
}

// --------------------------------------------------------------------------- pieces
function hostAndPath(url: string) {
  try {
    const u = new URL(url);
    const path = (u.pathname + u.search).replace(/\/$/, "");
    return { host: u.hostname.replace(/^(www|m|mobile)\./, ""), path: path.length > 42 ? path.slice(0, 40) + "…" : path };
  } catch {
    return { host: url, path: "" };
  }
}

/** Each pasted link on its own line: host in bold, the shortened path, ✓ or the red reason, and an open link. */
export function LinkLines({ links, checks, checking }: { links: string[]; checks?: LinkCheck[]; checking?: boolean }) {
  const { t, tf, lang } = useT();
  if (!links.length) return null;
  const byUrl = new Map((checks ?? []).map((c, i) => [`${i}|${c.url}`, c]));
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {links.map((url, i) => {
        const c = byUrl.get(`${i}|${url}`);
        const { host, path } = hostAndPath(url);
        const why = c?.problem === "wrong_platform" ? tf("link_wrong_platform", { hosts: "" }).replace(" ()", "")
          : c?.problem === "used_here" ? tf("link_used_here", { day: c.day ? dayMonth(c.day, lang) : "" })
          : c?.problem ? t(`link_${c.problem}` as "link_repeated") : "";
        return (
          <li key={`${i}|${url}`} className={cn("flex min-h-9 items-center gap-2 rounded-lg px-2 py-1 text-sm", c?.problem ? "bg-r-overdue-soft" : "bg-r-ground")}>
            {c?.problem ? <AlertCircle className="size-4 shrink-0 text-r-overdue" aria-hidden />
              : c ? <Check className="size-4 shrink-0 text-r-accepted" aria-label={t("link_ok")} />
              : <Loader2 className={cn("size-4 shrink-0 text-r-faint", checking && "animate-spin")} aria-hidden />}
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate"><b>{host}</b><span className="text-r-muted">{path}</span></span>
              {why && <span className="font-bold text-r-overdue-ink">{why}</span>}
            </span>
            <a href={url} target="_blank" rel="noopener noreferrer" title={t("link_open")} aria-label={`${t("link_open")}: ${host}`}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-r-action hover:bg-r-sunk">
              <ExternalLink className="size-4" aria-hidden />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** Auto-growing textarea for pasted links. On blur, words that aren't links are dropped. */
export function LinksInput({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { t } = useT();
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(64, el.scrollHeight + 2)}px`;
  }, [value]);
  return (
    <RTextarea ref={ref} id={id} value={value} disabled={disabled} rows={2} placeholder={t("proof_links_placeholder")}
      spellCheck={false} autoCapitalize="off" autoCorrect="off" inputMode="url"
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => { const links = parseLinks(value); const tidy = links.join("\n"); if (tidy !== value.trim()) onChange(tidy); }}
      className="min-h-16 resize-none overflow-hidden text-[15px] leading-snug" />
  );
}

/** "+ Add PDF / photo" and the list of files, each with its progress, size, open and remove. */
export function FileBox({ formId, files, disabled, onPick, onRemove }: {
  formId: number; files: FileItem[]; disabled?: boolean; onPick: (files: File[]) => void; onRemove: (uid: string) => void;
}) {
  const { t } = useT();
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1.5">
      {files.map((f) => (
        <div key={f.uid} className={cn("flex min-h-11 items-center gap-2 rounded-lg px-2 py-1.5 text-sm", f.status === "error" ? "bg-r-overdue-soft" : "bg-r-ground")}>
          {f.type === "application/pdf" ? <FileText className="size-5 shrink-0 text-r-muted" aria-hidden /> : <ImageIcon className="size-5 shrink-0 text-r-muted" aria-hidden />}
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate font-bold">{f.name}</span>
            {f.status === "uploading" ? (
              <span className="mt-1 h-1.5 overflow-hidden rounded bg-r-sunk" role="progressbar" aria-label={t("proof_uploading")}
                aria-valuenow={Math.round(f.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <span className="block h-full rounded bg-r-action transition-[width]" style={{ width: `${Math.max(4, f.progress * 100)}%` }} />
              </span>
            ) : f.status === "error" ? <span className="font-bold text-r-overdue-ink">{f.error}</span>
              : <span className="text-r-muted">{fmtSize(f.size)}</span>}
          </span>
          {f.id && (
            <a href={proofFileUrl(formId, f.id)} target="_blank" rel="noopener noreferrer" title={t("link_open")} aria-label={`${t("link_open")}: ${f.name}`}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-r-action hover:bg-r-sunk"><ExternalLink className="size-4" aria-hidden /></a>
          )}
          {!disabled && f.status !== "uploading" && (
            <button type="button" onClick={() => onRemove(f.uid)} title={t("remove")} aria-label={`${t("remove")}: ${f.name}`}
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-r-muted hover:bg-r-sunk hover:text-r-ink">
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <>
          <input ref={input} type="file" multiple accept="application/pdf,image/jpeg,image/png" className="hidden"
            onChange={(e) => { const list = Array.from(e.target.files ?? []); e.target.value = ""; if (list.length) onPick(list); }} />
          <button type="button" onClick={() => input.current?.click()}
            className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-dashed border-r-field bg-r-card px-3 text-[15px] font-bold text-r-action hover:border-r-action hover:bg-r-action-soft">
            {t("proof_add_file")}
          </button>
        </>
      )}
    </div>
  );
}

/** Read-only proof: clickable links, and file rows that open in a new tab (photos with a small thumbnail). */
export function ProofList({ formId, proofs }: { formId: number; proofs: Proof[] }) {
  const { t } = useT();
  const links = proofs.filter((p) => p.kind === "link");
  const files = proofs.filter((p) => p.kind === "file");
  if (!proofs.length) return <span className="text-sm text-r-muted">{t("proof_none_attached")}</span>;
  return (
    <div className="flex flex-col gap-1.5">
      {links.map((p) => {
        const { host, path } = hostAndPath(p.url ?? "");
        return (
          <a key={p.id} href={p.url ?? "#"} target="_blank" rel="noopener noreferrer"
            className="flex min-h-9 items-center gap-2 rounded-lg bg-r-ground px-2 py-1 text-sm text-r-ink no-underline hover:bg-r-sunk">
            <ExternalLink className="size-4 shrink-0 text-r-action" aria-hidden />
            <span className="min-w-0 truncate"><b>{host}</b><span className="text-r-muted">{path}</span></span>
          </a>
        );
      })}
      {files.map((p) => (
        <a key={p.id} href={proofFileUrl(formId, p.id)} target="_blank" rel="noopener noreferrer"
          className="flex min-h-11 items-center gap-2 rounded-lg bg-r-ground px-2 py-1.5 text-sm text-r-ink no-underline hover:bg-r-sunk">
          {p.type?.startsWith("image/")
            ? <img src={proofFileUrl(formId, p.id)} alt="" loading="lazy" className="size-10 shrink-0 rounded-md bg-r-sunk object-cover" />
            : <FileText className="size-5 shrink-0 text-r-muted" aria-hidden />}
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate font-bold">{p.name}</span>
            {p.size !== null && <span className="text-r-muted">{fmtSize(p.size)}</span>}
          </span>
          <ExternalLink className="size-4 shrink-0 text-r-action" aria-hidden />
        </a>
      ))}
    </div>
  );
}

/** The big read-only count that stands in for the number box on a links field, with "none today" while there are none. */
export function LinkCount({ id, count, bad, zero, disabled, onZero }: {
  id: string; count: number; bad: number; zero: boolean; disabled?: boolean; onZero: (on: boolean) => void;
}) {
  const { t, tf } = useT();
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <output id={id} aria-label={t("links_count")}
        className={cn("flex h-[54px] min-w-28 items-center justify-end rounded-xl bg-r-sunk/60 px-3.5 num text-xl font-semibold",
          count === 0 && !zero && "text-r-faint")}>
        {count > 0 || zero ? count : "—"}
      </output>
      {bad > 0 && <span className="text-xs font-bold text-r-overdue-ink">{tf("n_links_bad", { n: bad })}</span>}
      {count === 0 && bad === 0 && !disabled && (
        <RCheck plain checked={zero} onChange={onZero} className="text-sm">{t("links_none_today")}</RCheck>
      )}
    </span>
  );
}

export function fieldTakesFiles(f: FormField) { return f.proof === "files" || f.proof === "either"; }
export function fieldTakesLinks(f: FormField) { return f.proof === "links" || f.proof === "either"; }
