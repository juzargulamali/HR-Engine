"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { OsBadge } from "@/components/os/pills";
import { cn } from "@/lib/utils";
import { PROPOSED_NOTE, effectiveStatus, willPropose, type PreviewRow, type Resolutions, type RowStatus } from "@/lib/projects/delivery-plan/excel/plan";
import type { DpImportResponse } from "@/lib/projects/delivery-plan/excel/service";

type Ok<M extends "preview" | "confirm"> = Extract<DpImportResponse, { ok: true; mode: M }>;
type Step = "upload" | "preview" | "result";

const KIND: Record<RowStatus, { label: string; tone: "green" | "blue" | "neutral" | "amber" }> = {
  add: { label: "Add", tone: "green" }, update: { label: "Update", tone: "blue" }, unchanged: { label: "Unchanged", tone: "neutral" }, attention: { label: "Needs attention", tone: "amber" },
};
const rowId = (r: PreviewRow) => `${r.sheet}!${r.row}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className={cn("text-2xl font-semibold tabular-nums", tone === "amber" && value > 0 && "text-warning")}>{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function RowItem({ r, status, resolutions, onChoose, disabled }: { r: PreviewRow; status: RowStatus; resolutions: Resolutions; onChoose: (ref: string, value: string) => void; disabled: boolean }) {
  const where = `${r.sheet}, row ${r.row}`;
  return (
    <li className="space-y-2 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{where}</span>
        {r.key ? <span className="text-muted-foreground">{r.key}</span> : null}
        <span className="min-w-0 break-words">{r.label}</span>
        <OsBadge tone={KIND[status].tone}>{KIND[status].label}</OsBadge>
      </div>
      {willPropose(r, resolutions) ? <p className="font-medium">{PROPOSED_NOTE}</p> : null}
      {r.issues.map((e, n) => <p key={n} className="break-words text-warning">{where}, {e.field}: {e.message}</p>)}
      {r.issues.length === 0 && r.changes.length > 0 ? (
        <ul className="space-y-0.5 text-muted-foreground">
          {r.changes.map((c, n) => <li key={n} className="break-words">{c.field}: {r.baseStatus === "add" ? c.to : `${c.from || "not set"} to ${c.to}`}</li>)}
        </ul>
      ) : null}
      {r.choices.map((c) => {
        const value = resolutions[c.ref] ?? "";
        return (
          <div key={c.ref} className="space-y-1.5">
            <p className={cn("break-words", !value && "text-warning")}>{where}, {c.field}: {c.message}</p>
            <label htmlFor={`choice-${c.ref}`} className="sr-only">{c.field} for {where}</label>
            <Select id={`choice-${c.ref}`} value={value} disabled={disabled} onChange={(e) => onChoose(c.ref, e.target.value)} className="h-11 w-full sm:h-9 sm:max-w-sm">
              <option value="">Choose…</option>
              {c.candidates.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              <option value="skip">Skip: leave {c.field} as it is</option>
            </Select>
          </div>
        );
      })}
    </li>
  );
}

export function ImportFlow({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Ok<"preview"> | null>(null);
  const [resolutions, setResolutions] = useState<Resolutions>({});
  const [result, setResult] = useState<Ok<"confirm"> | null>(null);
  const [stale, setStale] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const base = `/api/projects/${projectId}/delivery-plan`;
  const back = `/projects/${projectId}/delivery`;

  async function send(mode: "preview" | "confirm") {
    if (!file || inFlight.current) return;
    inFlight.current = true; // a double click sends one request
    setBusy(true); setError(null);
    try {
      const body = new FormData();
      body.set("file", file); body.set("mode", mode);
      if (mode === "confirm" && preview) { body.set("rev", String(preview.rev)); body.set("resolutions", JSON.stringify(resolutions)); }
      const res = await fetch(`${base}/import`, { method: "POST", body });
      const json = (await res.json().catch(() => null)) as DpImportResponse | { error?: string; code?: string } | null;
      if (res.status === 409 && json && "code" in json && json.code) { setStale(true); setError(("error" in json && json.error) || "This preview is out of date. Nothing was imported. Upload the workbook again."); return; }
      if (!res.ok || !json || !("ok" in json)) { setError((json && "error" in json && json.error) || "Could not read the response. Check the Delivery plan before trying again."); return; }
      if (json.ok && json.mode === "preview") { setPreview(json); setResolutions({}); setStale(false); setStep("preview"); }
      else if (json.ok) { setResult(json); setStep("result"); }
    } catch {
      setError(mode === "confirm" ? "The connection dropped. Open the Delivery plan to see whether the import went through, then upload the workbook again." : "Could not reach the server. Nothing was saved; try again.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  const reset = () => { setStep("upload"); setFile(null); setPreview(null); setResolutions({}); setResult(null); setError(null); setStale(false); if (input.current) input.current.value = ""; };

  // The same rule as the server: a row with an unanswered choice needs attention; answered, it is an Add, an Update or Unchanged.
  const rows = (preview?.rows ?? []).map((r) => ({ r, status: effectiveStatus(r, resolutions) }));
  const of = (s: RowStatus) => rows.filter((x) => x.status === s);
  const counts = { add: of("add").length, update: of("update").length, attention: of("attention").length, unchanged: (preview?.summary.unchanged ?? 0) + of("unchanged").length };
  const changes = counts.add + counts.update;
  const proposals = rows.filter((x) => willPropose(x.r, resolutions)).length;
  const choose = (ref: string, value: string) => setResolutions((prev) => { const next = { ...prev }; if (value) next[ref] = value; else delete next[ref]; return next; });

  const group = (title: string, help: string, s: RowStatus) => {
    const list = of(s);
    return (
      <section className="space-y-2" aria-label={title}>
        <h3 className="flex flex-wrap items-center gap-2 font-semibold">{title} <OsBadge tone={s === "attention" && list.length > 0 ? "amber" : "neutral"}>{list.length}</OsBadge></h3>
        {list.length === 0 ? <p className="text-sm text-muted-foreground">No rows.</p> : (
          <>
            <p className="text-sm text-muted-foreground">{help}</p>
            <ul className="space-y-2">{list.map(({ r, status }) => <RowItem key={rowId(r)} r={r} status={status} resolutions={resolutions} onChoose={choose} disabled={busy} />)}</ul>
          </>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Steps">
        {(["upload", "preview", "result"] as const).map((k, n) => (
          <li key={k} aria-current={step === k ? "step" : undefined} className={cn("rounded-full border px-3 py-1", step === k ? "border-primary bg-secondary font-medium" : "border-border text-muted-foreground")}>
            {n + 1}. {k === "upload" ? "Upload" : k === "preview" ? "Preview and confirm" : "Result"}
          </li>
        ))}
      </ol>
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      {step === "upload" ? (
        <Card>
          <CardHeader><CardTitle>1. Upload a workbook</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">One row per deliverable on the Deliverables sheet. The Breakdown sheet is optional. Leave the ID empty for a new row. Excel .xlsx only, up to 4 MB, 1000 deliverable rows and 2000 breakdown rows.</p>
            {canManage ? null : <p className="text-sm text-muted-foreground">You can import Breakdown lines of the sections delegated to you. Deliverables and other sections are for the Project Manager.</p>}
            <a href={`${base}/template`} className={cn(buttonVariants({ variant: "outline" }))}><Download className="h-4 w-4" aria-hidden /> Download template</a>
            <div className="space-y-1.5">
              <label htmlFor="delivery-plan-import-file" className="text-sm font-medium leading-none">Excel file</label>
              <input id="delivery-plan-import-file" ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1" />
            </div>
            <Button type="button" onClick={() => send("preview")} disabled={!file || busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileSpreadsheet className="h-4 w-4" aria-hidden />} Check file and preview</Button>
          </CardContent>
        </Card>
      ) : null}

      {step === "preview" && preview ? (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>2. Preview: nothing has been saved yet</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="break-words text-sm text-muted-foreground">
                {file?.name} · {plural(preview.fileRows.deliverables, "deliverable row", "deliverable rows")}, {plural(preview.fileRows.breakdown, "breakdown row", "breakdown rows")}
                {preview.fileRows.examplesSkipped > 0 ? ` · ${plural(preview.fileRows.examplesSkipped, "example row", "example rows")} ignored` : ""}
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Add" value={counts.add} />
                <Stat label="Update" value={counts.update} />
                <Stat label="Unchanged" value={counts.unchanged} />
                <Stat label="Needs attention" value={counts.attention} tone="amber" />
              </div>
              <p className="text-sm">Nothing is saved until you confirm. Blank cells and missing rows never delete anything. Released rows become proposals for the Project Manager. Importing does not release anything: tasks and the equipment request are created only by Release on the Delivery plan.</p>
              {preview.warnings.length > 0 ? (
                <Alert variant="warning"><ul className="space-y-1">{preview.warnings.map((w, n) => <li key={n} className="break-words">{w}</li>)}</ul></Alert>
              ) : null}
            </CardContent>
          </Card>

          {group("Needs attention", "Nothing can be imported while a row is listed here. Answer the choices below, or correct the workbook and upload it again.", "attention")}
          {group("Add", "New rows that will be added to the plan.", "add")}
          {group("Update", "Rows already in the plan that will change. Only the cells you filled and changed are touched.", "update")}
          <section className="space-y-2" aria-label="Unchanged">
            <h3 className="flex flex-wrap items-center gap-2 font-semibold">Unchanged <OsBadge tone="neutral">{counts.unchanged}</OsBadge></h3>
            <p className="text-sm text-muted-foreground">{counts.unchanged === 0 ? "No rows." : `${plural(counts.unchanged, "row already matches", "rows already match")} the plan. Nothing happens for ${counts.unchanged === 1 ? "it" : "them"}.`}</p>
          </section>

          <Card>
            <CardHeader><CardTitle>3. Confirm</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {counts.attention > 0 ? <Alert variant="warning">{plural(counts.attention, "row needs", "rows need")} attention, so nothing can be imported yet.</Alert>
                : changes === 0 ? <Alert>Every row already matches the plan. There is nothing to import.</Alert>
                : <p className="text-sm">Confirming imports {plural(changes, "change", "changes")}, all at once or not at all{proposals > 0 ? `; ${plural(proposals, "of them is", "of them are")} proposed to the Project Manager because the row is already released` : ""}. The plan is checked again when you confirm: if it changed after this preview, nothing is imported and you are asked to upload the workbook again.</p>}
              <div className="flex flex-wrap gap-2">
                {stale ? null : (
                  <Button type="button" onClick={() => send("confirm")} disabled={busy || counts.attention > 0 || changes === 0}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Import {plural(changes, "change", "changes")}</Button>
                )}
                <Button type="button" variant={stale ? "default" : "outline"} onClick={reset} disabled={busy}>{stale ? "Upload the workbook again" : "Choose another file"}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {step === "result" && result ? (
        <Card>
          <CardHeader><CardTitle>4. Result</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="success">{result.nothingToDo ? "Nothing was changed: every row already matched the plan." : "The import finished."}</Alert>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Added" value={result.counts.added} />
              <Stat label="Updated" value={result.counts.updated} />
              <Stat label="Proposed to the Project Manager" value={result.counts.proposed} />
              <Stat label="Unchanged" value={result.counts.unchanged} />
            </div>
            <p className="text-sm text-muted-foreground">Nothing was released. Tasks and the equipment request are created only by Release on the Delivery plan.</p>
            <div className="flex flex-wrap gap-2">
              <Link href={back} className={buttonVariants({})}>Back to the Delivery plan</Link>
              <Button type="button" variant="outline" onClick={reset}>Import another file</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
