"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OsBadge } from "@/components/os/pills";
import { cn } from "@/lib/utils";
import type { ImportResponse, PlanItem, PreviewGroups } from "@/lib/crm/clients-agencies/import/service";

type Ok<M extends "preview" | "confirm"> = Extract<ImportResponse, { ok: true; mode: M }>;
type Step = "upload" | "preview" | "result";

const GROUP_TITLE: Record<keyof PreviewGroups, { title: string; help: string }> = {
  new: { title: "New organisations", help: "Will be created when you confirm." },
  fill: { title: "Existing organisations to update", help: "Only empty fields are filled and only new contacts are added." },
  noChange: { title: "Existing, nothing to change", help: "Already recorded. Nothing happens for these." },
  conflicts: { title: "Conflicts (not overwritten)", help: "The file says something different from what is recorded. Existing values are kept; change them by hand if the file is right." },
  ambiguous: { title: "Ambiguous matches (not merged)", help: "More than one existing organisation could be this one. Nothing was merged or changed." },
  review: { title: "Needs review", help: "Flagged rows: unknown type or country, owner that could not be verified, or values that differ inside the file." },
};
const GROUP_ORDER: (keyof PreviewGroups)[] = ["new", "fill", "noChange", "conflicts", "ambiguous", "review"];

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" | "green" }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className={cn("text-2xl font-semibold tabular-nums", tone === "amber" && value > 0 && "text-warning")}>{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function ItemRow({ item }: { item: PlanItem }) {
  return (
    <li className="space-y-1 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-words font-medium">{item.name}</span>
        {item.types.map((t) => <OsBadge key={t} tone="neutral">{t}</OsBadge>)}
        <span className="text-muted-foreground">row{item.rows.length === 1 ? "" : "s"} {item.rows.join(", ")}</span>
      </div>
      {item.match && item.match !== item.name ? <p className="text-muted-foreground">Matches existing: {item.match}</p> : null}
      {item.adds.length ? <p>{item.adds.join(" · ")}</p> : null}
      {item.conflicts.length ? (
        <table className="w-full text-left text-sm">
          <thead className="text-muted-foreground"><tr><th className="pr-3 font-normal">Field</th><th className="pr-3 font-normal">Recorded</th><th className="font-normal">In the file</th></tr></thead>
          <tbody>{item.conflicts.map((c) => <tr key={c.field}><td className="pr-3 align-top">{c.field}</td><td className="break-words pr-3 align-top">{c.existing || "empty"}</td><td className="break-words align-top">{c.file || "empty"}</td></tr>)}</tbody>
        </table>
      ) : null}
      {item.candidates.length ? <p>Could be: {item.candidates.join("; ")}</p> : null}
      {item.flags.map((f) => <p key={f} className="text-warning">{f}</p>)}
    </li>
  );
}

function Groups({ groups, totals, truncated, only }: { groups: PreviewGroups; totals: Record<keyof PreviewGroups, number>; truncated: boolean; only?: (keyof PreviewGroups)[] }) {
  return (
    <div className="space-y-3">
      {GROUP_ORDER.filter((k) => totals[k] > 0 && (!only || only.includes(k))).map((k) => (
        <details key={k} className="rounded-md border border-border" open={k === "conflicts" || k === "ambiguous" || k === "review"}>
          <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 px-3 py-2 font-medium">{GROUP_TITLE[k].title} <OsBadge tone="neutral">{totals[k]}</OsBadge></summary>
          <div className="space-y-2 px-3 pb-3">
            <p className="text-sm text-muted-foreground">{GROUP_TITLE[k].help}</p>
            <ul className="space-y-2">{groups[k].map((i, n) => <ItemRow key={`${i.name}-${n}`} item={i} />)}</ul>
            {totals[k] > groups[k].length ? <p className="text-sm text-muted-foreground">Showing the first {groups[k].length} of {totals[k]}.</p> : null}
          </div>
        </details>
      ))}
      {truncated ? <p className="text-sm text-muted-foreground">Long lists are shortened here; every row is still checked and counted.</p> : null}
    </div>
  );
}

export function ImportFlow({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Ok<"preview"> | null>(null);
  const [result, setResult] = useState<Ok<"confirm"> | null>(null);
  /** The database said the records changed after the preview: nothing was imported and a fresh preview is needed. */
  const [stale, setStale] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);

  async function send(mode: "preview" | "confirm") {
    if (!file || inFlight.current) return;
    inFlight.current = true; // a double-click sends one request
    setBusy(true); setError(null);
    try {
      const body = new FormData();
      body.set("file", file); body.set("companyId", companyId); body.set("mode", mode);
      if (mode === "confirm" && preview) body.set("fingerprints", JSON.stringify(preview.fingerprints));
      const res = await fetch("/api/sales/accounts/import", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as ImportResponse | { error?: string; code?: string } | null;
      if (res.status === 409 && json && "code" in json && json.code === "preview_stale") { setStale(true); setError(("error" in json && json.error) || "This preview is out of date. Run a fresh preview."); return; }
      if (!res.ok || !json || !("ok" in json)) { setError((json && "error" in json && json.error) || "Could not read the response. Nothing was changed; check the accounts list before trying again."); return; }
      if (json.ok && json.mode === "preview") { setPreview(json); setStale(false); setStep("preview"); }
      else if (json.ok) { setResult(json); setStep("result"); }
    } catch {
      setError(mode === "confirm" ? "The connection dropped. Check Clients & Agencies to see whether the import went through, then run the preview again." : "Could not reach the server. Nothing was changed; try again.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  const reset = () => { setStep("upload"); setFile(null); setPreview(null); setResult(null); setError(null); setStale(false); if (input.current) input.current.value = ""; };
  const s = preview?.summary;
  const back = `/sales/accounts?company=${companyId}`;

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
            <p className="text-sm text-muted-foreground">Importing into <span className="font-medium text-foreground">{companyName}</span>. Use the template, or a workbook with the headers Client name, location and Type. Excel .xlsx only, up to 4 MB and 2000 rows; macros are refused.</p>
            <a href="/api/sales/accounts/import/template" className={cn(buttonVariants({ variant: "outline" }))}><Download className="h-4 w-4" aria-hidden /> Download template</a>
            <div className="space-y-1.5">
              <label htmlFor="import-file" className="text-sm font-medium leading-none">Excel file</label>
              <input id="import-file" ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
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
              <p className="text-sm text-muted-foreground">{file?.name} · into {companyName}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <Stat label="Rows in the file" value={s.sourceRows} />
                <Stat label="Organisations in the file" value={s.candidates} />
                <Stat label="New organisations" value={s.newOrganisations} />
                <Stat label="Existing matches" value={s.existingMatches} />
                <Stat label="Existing, to fill in" value={s.existingWithFills} />
                <Stat label="Existing, nothing to change" value={s.existingNoChange} />
                <Stat label="Contacts to add" value={s.contactsToAdd} />
                <Stat label="Contacts already recorded" value={s.contactsAlreadyThere} />
                <Stat label="Repeated rows collapsed" value={s.duplicateRows} />
                <Stat label="Conflicts (kept as recorded)" value={s.conflictFields} tone="amber" />
                <Stat label="Ambiguous matches" value={s.ambiguous} tone="amber" />
                <Stat label="Unnamed rows skipped" value={s.unnamedRows} tone="amber" />
                <Stat label="Rows with errors" value={s.rowErrors} tone="amber" />
                <Stat label="Owners to assign" value={s.ownersToAssign} />
              </div>
              <p className="text-sm text-muted-foreground">
                By type: {s.byType.agency} agencies · {s.byType.direct} direct clients · {s.byType.client} end clients · {s.byType.technology} technology companies{s.byType.notRecorded ? ` · ${s.byType.notRecorded} without a recognised type` : ""}. Counted before matching with existing records.
                {s.exampleRows ? ` ${s.exampleRows} example row(s) were ignored.` : ""}
              </p>
              {preview.ignoredColumns.length ? <p className="text-sm text-muted-foreground">Columns not imported: {preview.ignoredColumns.join(", ")}.</p> : null}
            </CardContent>
          </Card>

          {preview.rowErrors.length > 0 ? (
            <Alert variant="warning">
              <p className="font-medium">Row errors ({s.rowErrors}). These rows or contacts are not imported:</p>
              <ul className="mt-1 list-disc pl-5">{preview.rowErrors.map((e, n) => <li key={n}>Row {e.row}: {e.message}</li>)}</ul>
            </Alert>
          ) : null}
          {preview.unnamedRows.length > 0 ? <Alert>Rows without an organisation name are skipped: {preview.unnamedRows.join(", ")}.</Alert> : null}
          {preview.duplicates.length > 0 ? (
            <details className="rounded-md border border-border">
              <summary className="min-h-11 cursor-pointer px-3 py-2 font-medium">Repeated rows collapsed into one organisation ({s.duplicateRows})</summary>
              <ul className="space-y-1 px-3 pb-3 text-sm">{preview.duplicates.map((d) => <li key={d.row}>Row {d.row}: {d.name}</li>)}</ul>
            </details>
          ) : null}

          <Groups groups={preview.groups} totals={preview.totals} truncated={preview.truncated} />

          <Card>
            <CardHeader><CardTitle>3. Confirm</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">Confirming will create {s.newOrganisations} new organisation{s.newOrganisations === 1 ? "" : "s"}, fill empty fields on {s.existingWithFills} existing one{s.existingWithFills === 1 ? "" : "s"}, and add {s.contactsToAdd} new contact{s.contactsToAdd === 1 ? "" : "s"}. Conflicts, ambiguous matches and flagged owners are left alone. The records are checked again when you confirm: if anything changed since this preview, nothing is imported and you are asked to preview again.</p>
              <div className="flex flex-wrap gap-2">
                {stale ? (
                  <Button type="button" onClick={() => send("preview")} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Run a fresh preview</Button>
                ) : (
                  <Button type="button" onClick={() => send("confirm")} disabled={busy || s.safeActions === 0}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} {s.safeActions === 0 ? "Nothing to apply" : "Confirm import"}</Button>
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
              {result.repeated ? <Alert>This file had already been imported from this preview, so nothing new was done. The figures below are from the first run.</Alert> : null}
              {result.result.failed.length === 0 ? <Alert variant="success">The import finished.</Alert> : <Alert variant="warning">The import finished, but {result.result.failed.length} organisation{result.result.failed.length === 1 ? "" : "s"} could not be saved. Nothing else was affected.</Alert>}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <Stat label="Organisations created" value={result.result.created} />
                <Stat label="Existing organisations updated" value={result.result.updated} />
                <Stat label="Contacts added" value={result.result.contactsAdded} />
                <Stat label="Owners assigned" value={result.result.ownersAssigned} />
                <Stat label="Left as they were" value={result.result.untouched} />
                <Stat label="Could not be saved" value={result.result.failed.length} tone="amber" />
              </div>
              {result.result.failed.length > 0 ? <ul className="list-disc space-y-1 pl-5 text-sm">{result.result.failed.map((f, n) => <li key={n}>{f.name} (rows {f.rows.join(", ")}): {f.message}</li>)}</ul> : null}
              <p className="text-sm text-muted-foreground">Importing the same file again creates nothing new.</p>
              <div className="flex flex-wrap gap-2">
                <Link href={back} className={buttonVariants({})}>View Clients &amp; Agencies</Link>
                <Button type="button" variant="outline" onClick={reset}>Import another file</Button>
              </div>
            </CardContent>
          </Card>
          <Groups groups={result.review} totals={result.totals} truncated={result.truncated} only={["conflicts", "ambiguous", "review"]} />
        </div>
      ) : null}
    </div>
  );
}
