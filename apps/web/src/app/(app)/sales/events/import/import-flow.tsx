"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OsBadge } from "@/components/os/pills";
import { cn } from "@/lib/utils";
import type { ImportResponse, PreviewRow, RowStatus } from "@/lib/crm/events/import/service";

type Ok<M extends "preview" | "confirm"> = Extract<ImportResponse, { ok: true; mode: M }>;
type Step = "upload" | "preview" | "result";

const KIND: Record<RowStatus, { label: string; tone: "green" | "neutral" | "amber" }> = {
  new_event: { label: "New event", tone: "green" },
  new_edition: { label: "Adds an edition", tone: "green" },
  present: { label: "Already present", tone: "neutral" },
  conflict: { label: "Needs correction: conflict", tone: "amber" },
  ambiguous: { label: "Needs correction: ambiguous", tone: "amber" },
  review: { label: "Needs correction: review", tone: "amber" },
  invalid: { label: "Needs correction: invalid", tone: "amber" },
};
const NEEDS: RowStatus[] = ["invalid", "conflict", "ambiguous", "review"];

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className={cn("text-2xl font-semibold tabular-nums", tone === "amber" && value > 0 && "text-warning")}>{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function RowItem({ r }: { r: PreviewRow }) {
  const k = KIND[r.status];
  const what = r.status === "new_event" ? "Creates the event and this edition" : r.status === "new_edition" ? (r.eventIsNew ? "Adds an edition to the event created by an earlier row" : "Adds an edition to the existing event") : null;
  const place = [r.city, r.country].filter(Boolean).join(", ");
  return (
    <li className="space-y-1 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Row {r.row}</span>
        <span className="break-words">{r.event || "(no event name)"}</span>
        <OsBadge tone={k.tone}>{k.label}</OsBadge>
      </div>
      {r.start || r.end ? <p className="text-muted-foreground">{r.start}{r.end ? ` to ${r.end}` : ""}{place ? ` · ${place}` : ""}{r.venue ? ` · ${r.venue}` : ""}</p> : null}
      {what ? <p>{what}</p> : null}
      {r.reason ? <p className={cn(NEEDS.includes(r.status) && "text-warning")}>{r.reason}</p> : null}
      {r.note ? <p className="text-muted-foreground">{r.note}</p> : null}
    </li>
  );
}

function Group({ title, help, rows, open }: { title: string; help: string; rows: PreviewRow[]; open?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <details className="rounded-md border border-border" open={open}>
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 px-3 py-2 font-medium">{title} <OsBadge tone="neutral">{rows.length}</OsBadge></summary>
      <div className="space-y-2 px-3 pb-3">
        <p className="text-sm text-muted-foreground">{help}</p>
        <ul className="space-y-2">{rows.map((r) => <RowItem key={r.row} r={r} />)}</ul>
      </div>
    </details>
  );
}

function Groups({ rows, only }: { rows: PreviewRow[]; only?: "all" | "skipped" }) {
  const by = (...s: RowStatus[]) => rows.filter((r) => s.includes(r.status));
  return (
    <div className="space-y-3">
      {only !== "skipped" ? <Group title="Rows that need correcting" help="Nothing is saved while any row is listed here. Correct these rows in your file, upload it again and preview." rows={by(...NEEDS)} open /> : null}
      {only !== "skipped" ? <Group title="New events" help="Will create the event and its first edition from this file." rows={by("new_event")} open /> : null}
      {only !== "skipped" ? <Group title="Editions added to events" help="Will add an edition under an existing event, or under an event created earlier in this file." rows={by("new_edition")} open /> : null}
      <Group title="Already present (skipped)" help="This edition is already in the calendar with the same dates. Nothing happens for these rows." rows={by("present")} />
    </div>
  );
}

export function ImportFlow() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Ok<"preview"> | null>(null);
  const [result, setResult] = useState<Ok<"confirm"> | null>(null);
  const [stale, setStale] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);

  async function send(mode: "preview" | "confirm") {
    if (!file || inFlight.current) return;
    inFlight.current = true; // a double click sends one request
    setBusy(true); setError(null);
    try {
      const body = new FormData();
      body.set("file", file); body.set("mode", mode);
      if (mode === "confirm" && preview) body.set("expect", String(preview.summary.newEditions));
      const res = await fetch("/api/sales/events/import", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as ImportResponse | { error?: string; code?: string } | null;
      if (res.status === 409 && json && "code" in json && json.code) { setStale(true); setError(("error" in json && json.error) || "This preview is out of date. Run a fresh preview."); return; }
      if (!res.ok || !json || !("ok" in json)) { setError((json && "error" in json && json.error) || "Could not read the response. Nothing was saved; check the calendar before trying again."); return; }
      if (json.ok && json.mode === "preview") { setPreview(json); setStale(false); setStep("preview"); }
      else if (json.ok) { setResult(json); setStep("result"); }
    } catch {
      setError(mode === "confirm" ? "The connection dropped. Check Events & Exhibitions to see whether the import went through, then preview again." : "Could not reach the server. Nothing was saved; try again.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  const reset = () => { setStep("upload"); setFile(null); setPreview(null); setResult(null); setError(null); setStale(false); if (input.current) input.current.value = ""; };
  const s = preview?.summary;

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
          <CardHeader><CardTitle>1. Upload a file</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">One row per edition: Event name, Country, City, Venue, Start date, End date. Event name, Country, Start date and End date are required; dates are YYYY-MM-DD or normal Excel dates. Excel .xlsx or .csv, up to 4 MB and 2000 rows.</p>
            <a href="/api/sales/events/import/template" className={cn(buttonVariants({ variant: "outline" }))}><Download className="h-4 w-4" aria-hidden /> Download template</a>
            <div className="space-y-1.5">
              <label htmlFor="events-import-file" className="text-sm font-medium leading-none">Excel or CSV file</label>
              <input id="events-import-file" ref={input} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1" />
            </div>
            <Button type="button" onClick={() => send("preview")} disabled={!file || busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileSpreadsheet className="h-4 w-4" aria-hidden />} Check file and preview</Button>
          </CardContent>
        </Card>
      ) : null}

      {step === "preview" && preview && s ? (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>2. Preview: nothing has been saved yet</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{file?.name} · into the shared calendar</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <Stat label="Rows in the file" value={s.fileRows} />
                <Stat label="New events" value={s.newEvents} />
                <Stat label="Editions to add" value={s.newEditions} />
                <Stat label="Already present" value={s.present} />
                <Stat label="Rows to correct" value={s.needsCorrection} tone="amber" />
              </div>
              {preview.ignoredColumns.length ? <p className="text-sm text-muted-foreground">Columns not imported: {preview.ignoredColumns.join(", ")}.</p> : null}
            </CardContent>
          </Card>
          <Groups rows={preview.rows} />
          <Card>
            <CardHeader><CardTitle>3. Confirm</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {s.needsCorrection > 0 ? <Alert variant="warning">{s.needsCorrection} row{s.needsCorrection === 1 ? "" : "s"} need correcting, so nothing can be saved yet. Correct the file, then choose it again.</Alert>
                : s.newEditions === 0 ? <Alert>Every row is already in the calendar. There is nothing to add.</Alert>
                : <p className="text-sm">Confirming will create {s.newEvents} new event{s.newEvents === 1 ? "" : "s"} and add {s.newEditions} edition{s.newEditions === 1 ? "" : "s"}, all at once or not at all. {s.present} already-present row{s.present === 1 ? " is" : "s are"} skipped. Existing events and editions are never changed. The calendar is checked again when you confirm: if it changed since this preview, nothing is saved and you are asked to preview again.</p>}
              <div className="flex flex-wrap gap-2">
                {stale ? (
                  <Button type="button" onClick={() => send("preview")} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Run a fresh preview</Button>
                ) : (
                  <Button type="button" onClick={() => send("confirm")} disabled={busy || !preview.canConfirm}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} {preview.canConfirm ? `Confirm: add ${s.newEditions} edition${s.newEditions === 1 ? "" : "s"}` : "Nothing to save yet"}</Button>
                )}
                <Button type="button" variant="outline" onClick={reset} disabled={busy}>Choose another file</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {step === "result" && result ? (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>4. Result</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="success">{result.added.editions === 0 ? "Nothing new was added: every row was already in the calendar." : "The import finished."}</Alert>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Events added" value={result.added.events} />
                <Stat label="Editions added" value={result.added.editions} />
                <Stat label="Rows skipped (already present)" value={result.skipped} />
              </div>
              <p className="text-sm text-muted-foreground">Importing the same file again adds nothing.</p>
              <div className="flex flex-wrap gap-2">
                <Link href="/sales/events?when=all" className={buttonVariants({})}>View Events &amp; Exhibitions</Link>
                <Button type="button" variant="outline" onClick={reset}>Import another file</Button>
              </div>
            </CardContent>
          </Card>
          <Groups rows={result.rows} only="skipped" />
        </div>
      ) : null}
    </div>
  );
}
