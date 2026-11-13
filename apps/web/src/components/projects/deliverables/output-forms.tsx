"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CRM_ALLOWED_FILE_SUMMARY, validateCrmFileMeta } from "@enginious-hr/domain";
import { assignOutputReviewer, decideTaskOutput, linkFeedbackToOutput, rerouteOutputReview, saveTaskOutput, submitTaskOutput } from "@/lib/actions/projectsPhase2";
import { finalizeProjectUpload, getProjectFileUrl, prepareProjectUpload } from "@/lib/actions/projectsFiles";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { FormDialog, type Done } from "@/components/projects/delivery/delivery-forms";

/** Expected output of a task: what it must produce, how many, and whether it is required before the task can go to review or be completed. Project Manager or the team head. */
export function ExpectedOutputDialog({ projectId, taskId, taskVersion, current }: { projectId: string; taskId: string; taskVersion: number; current: { label: string; qty: number | null; required: boolean } | null }) {
  return (
    <FormDialog label={current ? "Edit expected output" : "Set expected output"} title="Expected output" testId="output-expected-open"
      description="What this task must produce, for example one moodboard, three videos, an app build or an installation checklist. When it is required, the task cannot be sent for review or completed without it.">
      {(done) => (
        <ActionForm action={saveTaskOutput} submitLabel="Save" onDone={(s) => done(s as Done)}>
          <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="taskId" value={taskId} /><input type="hidden" name="expectedVersion" value={taskVersion} />
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_7rem]">
            <Field label="What it is" htmlFor="eo-label" hint="Leave empty to remove the expected output (not possible once a version was submitted)."><Input id="eo-label" name="label" maxLength={200} defaultValue={current?.label ?? ""} placeholder="Storyboard" /></Field>
            <Field label="How many" htmlFor="eo-qty"><Input id="eo-qty" name="qty" type="number" min={1} max={999} step={1} defaultValue={current?.qty ?? ""} placeholder="1" /></Field>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="required" defaultChecked={current?.required ?? false} className="mt-0.5 h-4 w-4" /> <span><span className="font-medium">Required.</span> The server refuses to send the task for review, or to complete it, without this output.</span></label>
        </ActionForm>
      )}
    </FormDialog>
  );
}

type Choice = { id: string; name: string; kind: "file" | "link" };
type Phase = "idle" | "checking" | "uploading" | "verifying" | "saving";

/**
 * Submit a version: upload a file, choose a project file, or add an https link. Everything you typed stays if the save is refused. One attempt has one key, so pressing Submit twice or
 * retrying after a dropped connection makes one version. A link is flagged as a document that can change; a snapshot file (or a version-specific link) lets the team retrieve the exact material.
 */
export function SubmitVersionDialog({ projectId, taskId, label, expected, nextNo, files }: { projectId: string; taskId: string; label: string; expected: number; nextNo: number; files: Choice[] | null }) {
  return (
    <FormDialog label={nextNo === 1 ? "Submit output" : `Submit version ${nextNo}`} variant="default" title={`Submit version ${nextNo}: ${label}`} testId="output-submit-open"
      description="Attach the material for review. A new version never changes an earlier one: each version keeps its own time, submitter and review.">
      {(done) => <SubmitForm projectId={projectId} taskId={taskId} expected={expected} nextNo={nextNo} files={files} done={done} />}
    </FormDialog>
  );
}

function SubmitForm({ projectId, taskId, expected, nextNo, files, done }: { projectId: string; taskId: string; expected: number; nextNo: number; files: Choice[] | null; done: (s: Done) => void }) {
  const router = useRouter();
  // One key per OPEN dialog (one attempt): pressing Submit twice, or retrying after a dropped connection, makes one version.
  const [attemptKey] = useState(() => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`));
  const [mode, setMode] = useState<"upload" | "existing" | "link">("upload");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [vals, setVals] = useState({ fileId: "", snapshotFileId: "", url: "", linkLabel: "", itemCount: String(expected), note: "", mutable: true });
  const set = (p: Partial<typeof vals>) => setVals((v) => ({ ...v, ...p }));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (phase !== "idle") return;
    setError(null);
    const fd = new FormData();
    fd.set("projectId", projectId); fd.set("taskId", taskId); fd.set("clientKey", attemptKey); fd.set("itemCount", vals.itemCount); fd.set("note", vals.note); fd.set("expectedCurrent", String(nextNo - 1));
    if (vals.snapshotFileId) fd.set("snapshotFileId", vals.snapshotFileId);
    try {
      if (mode === "upload") {
        const file = new FormData(e.currentTarget).get("file");
        if (!(file instanceof File) || file.size === 0) return setError("Choose a file to upload.");
        const problem = validateCrmFileMeta({ name: file.name, size: file.size, type: file.type });
        if (problem) return setError(problem);
        setPhase("checking");
        const prepared = await prepareProjectUpload({ projectId, name: file.name, size: file.size, type: file.type, purpose: "document", label: vals.linkLabel || file.name, restricted: false });
        if (prepared.error !== null) return setError(prepared.error);
        setPhase("uploading");
        const { error: upErr } = await createClient().storage.from("proj-quarantine").uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
        if (upErr) return setError("The upload did not complete. Check your connection and try again; your other entries are kept.");
        setPhase("verifying");
        const fin = await finalizeProjectUpload(prepared.intentId);
        if (fin.error) return setError(fin.error);
        fd.set("fileId", String((fin as { id?: string }).id ?? ""));
      } else if (mode === "existing") {
        if (!vals.fileId) return setError("Choose one of the project's files.");
        fd.set("fileId", vals.fileId);
      } else {
        if (!vals.url.trim()) return setError("Enter the link, starting with https://");
        fd.set("url", vals.url.trim()); fd.set("linkLabel", vals.linkLabel); fd.set("mutableLink", vals.mutable ? "on" : "off");
      }
      setPhase("saving");
      const r = await submitTaskOutput({ error: null }, fd);
      if (r.error) return setError(r.error);
      router.refresh();
      done({ error: null, notice: r.notice ?? "Submitted." });
    } catch {
      setError("Something went wrong. Nothing was lost: try again.");
    } finally {
      setPhase("idle");
    }
  }
  const busy = phase !== "idle";
  const tabs: { key: typeof mode; label: string }[] = [{ key: "upload", label: "Upload a file" }, { key: "existing", label: "Choose a project file" }, { key: "link", label: "Add a link" }];
  return (
    <form onSubmit={onSubmit} className="space-y-4" data-testid="output-submit-form">
      <div role="tablist" aria-label="How to attach it" className="flex flex-wrap gap-1 rounded-lg border border-border p-1">
        {tabs.map((t) => <button key={t.key} type="button" role="tab" aria-selected={mode === t.key} onClick={() => setMode(t.key)} className={`min-h-9 rounded-md px-3 text-sm font-medium ${mode === t.key ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{t.label}</button>)}
      </div>
      {mode === "upload" ? <Field label="File" htmlFor="ov-file" hint={`${CRM_ALLOWED_FILE_SUMMARY}. It is stored privately and checked before it can be opened.`}><Input id="ov-file" name="file" type="file" disabled={busy} /></Field> : null}
      {mode === "existing" ? (
        files === null ? <Alert variant="warning" role="status">The project&apos;s files could not be loaded just now. Upload a file or add a link instead.</Alert>
          : files.length === 0 ? <p className="text-sm text-muted-foreground">There are no project files you can use yet. Upload one or add a link.</p>
          : <Field label="Project file or link" htmlFor="ov-existing" hint="Only files you may open are listed. Choosing one never gives anyone else access to it."><Select id="ov-existing" value={vals.fileId} onChange={(e) => set({ fileId: e.target.value })}><option value="">Choose…</option>{files.map((f) => <option key={f.id} value={f.id}>{f.kind === "link" ? "Link: " : ""}{f.name}</option>)}</Select></Field>
      ) : null}
      {mode === "link" ? (
        <div className="space-y-3">
          <Field label="Link (https://)" htmlFor="ov-url"><Input id="ov-url" value={vals.url} onChange={(e) => set({ url: e.target.value })} inputMode="url" placeholder="https://" maxLength={1000} /></Field>
          <Field label="Name for the link (optional)" htmlFor="ov-linklabel"><Input id="ov-linklabel" value={vals.linkLabel} onChange={(e) => set({ linkLabel: e.target.value })} maxLength={200} /></Field>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={vals.mutable} onChange={(e) => set({ mutable: e.target.checked })} className="mt-0.5 h-4 w-4" /><span>This link points to a document that can change after it is approved (a shared deck, a design file). Untick it only for a version-specific link.</span></label>
        </div>
      ) : null}
      {mode === "link" || (mode === "existing" && files?.find((f) => f.id === vals.fileId)?.kind === "link") ? (
        <Field label="Snapshot of the exact material (optional)" htmlFor="ov-snap" hint="A stored file of what the link showed when submitted, so the team can retrieve exactly what was approved.">
          <Select id="ov-snap" value={vals.snapshotFileId} onChange={(e) => set({ snapshotFileId: e.target.value })}><option value="">No snapshot</option>{(files ?? []).filter((f) => f.kind === "file").map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>
        </Field>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <Field label={expected > 1 ? `How many (${expected} expected)` : "How many"} htmlFor="ov-count"><Input id="ov-count" type="number" min={1} max={999} step={1} value={vals.itemCount} onChange={(e) => set({ itemCount: e.target.value })} /></Field>
        <Field label="Note for the reviewer (optional)" htmlFor="ov-note"><Textarea id="ov-note" rows={2} maxLength={1000} value={vals.note} onChange={(e) => set({ note: e.target.value })} /></Field>
      </div>
      {error ? <Alert variant="destructive" role="alert" data-testid="output-submit-error">{error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-2"><Button type="submit" disabled={busy} data-testid="output-submit-go">{{ idle: `Submit version ${nextNo}`, checking: "Checking…", uploading: "Uploading…", verifying: "Verifying…", saving: "Saving…" }[phase]}</Button></div>
    </form>
  );
}

/** Review ONE version (the one on this screen). If a newer version exists the database refuses and says which one to review. */
export function DecideDialog({ projectId, versionId, versionNo, label }: { projectId: string; versionId: string; versionNo: number; label: string }) {
  const [decision, setDecision] = useState<"approved" | "changes_requested">("approved");
  return (
    <FormDialog label="Review" variant="default" title={`Review version ${versionNo}: ${label}`} testId="output-review-open"
      description={`Your decision applies to version ${versionNo} only. If a newer version is submitted meanwhile, you will be told and nothing is approved by mistake.`}>
      {(done) => (
        <ActionForm action={decideTaskOutput} submitLabel={decision === "approved" ? "Approve this version" : "Request changes"} variant={decision === "approved" ? "default" : "outline"} onDone={(s) => done(s as Done)}>
          <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="versionId" value={versionId} />
          <Field label="Decision" htmlFor="od-decision"><Select id="od-decision" name="decision" value={decision} onChange={(e) => setDecision(e.target.value as "approved" | "changes_requested")}><option value="approved">Approve version {versionNo}</option><option value="changes_requested">Request changes</option></Select></Field>
          <Field label={decision === "changes_requested" ? "What needs changing (required)" : "Note (optional)"} htmlFor="od-note"><Textarea id="od-note" name="note" rows={3} maxLength={2000} required={decision === "changes_requested"} /></Field>
        </ActionForm>
      )}
    </FormDialog>
  );
}

/** Open or download a file (a short-lived link issued only to someone the file's own row security lets see it), or follow a link. */
export function OpenOutputButton({ fileId, kind, url, label = "Open" }: { fileId: string; kind: "file" | "link"; url?: string | null; label?: string }) {
  const [error, setError] = useState<string | null>(null);
  if (kind === "link" && url) return <a href={url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-accent underline-offset-4 hover:underline">{label} link</a>;
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="text-[13px] font-medium text-accent underline-offset-4 hover:underline" onClick={async () => { setError(null); const r = await getProjectFileUrl(fileId); if (r.url) window.open(r.url, "_blank", "noopener"); else setError(r.error ?? "The file could not be opened."); }}>{kind === "file" ? "Download" : label}</button>
      {error ? <span role="alert" className="text-[13px] text-destructive">{error}</span> : null}
    </span>
  );
}

/** Link recorded client feedback to the version (and activation) it is about. Display and history only: scope, date and booking changes still use their own approval paths. */
export function LinkFeedbackDialog({ projectId, versionId, feedback, activations }: { projectId: string; versionId: string; feedback: { id: string; name: string }[]; activations: { id: string; name: string }[] }) {
  if (feedback.length === 0) return null;
  return (
    <FormDialog label="Link client feedback" variant="ghost" title="Link client feedback to this version" description="Shows the feedback beside this version and in its history. It changes no scope, date or booking: those still go through Feedback & changes.">
      {(done) => (
        <ActionForm action={linkFeedbackToOutput} submitLabel="Link" onDone={(s) => done(s as Done)}>
          <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="versionId" value={versionId} />
          <Field label="Feedback" htmlFor="lf-fb"><Select id="lf-fb" name="feedbackId" required><option value="">Choose…</option>{feedback.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
          {activations.length > 0 ? <Field label="Activation (optional)" htmlFor="lf-act"><Select id="lf-act" name="activationId" defaultValue=""><option value="">None</option>{activations.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field> : null}
        </ActionForm>
      )}
    </FormDialog>
  );
}

/** A Project Manager version that is still waiting on the team route (submitted before the Operations rule): send it to Operations without uploading it again. */
export function RerouteDialog({ projectId, versionId, versionNo, restricted }: { projectId: string; versionId: string; versionNo: number; restricted: boolean }) {
  return (
    <FormDialog label="Send to Operations review" title={`Send version ${versionNo} to Operations`} testId="output-reroute"
      description="This version was submitted by the Project Manager, so an Operations Manager reviews it, not the team. Nothing is uploaded again, and earlier decisions on this task stay as they are.">
      {(done) => (
        <ActionForm action={rerouteOutputReview} submitLabel="Send to Operations" onDone={(s) => done(s as Done)}>
          <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="versionId" value={versionId} />
          {restricted ? <p className="text-[13px] text-[hsl(var(--os-amber))]" data-testid="output-reroute-restricted">The file is restricted and Operations cannot open restricted files. Make it unrestricted in Files &amp; client plan first, then send it.</p> : null}
        </ActionForm>
      )}
    </FormDialog>
  );
}

/** Assign (or release) the Operations reviewer of a version waiting for review. The Project Manager or an Operations Manager; only people who may review it are offered. */
export function AssignReviewerDialog({ projectId, versionId, versionNo, current, eligible }: { projectId: string; versionId: string; versionNo: number; current: string; eligible: { id: string; name: string }[] }) {
  return (
    <FormDialog label={current ? "Reassign reviewer" : "Assign reviewer"} title={`Operations reviewer for version ${versionNo}`} testId="output-assign-reviewer"
      description="Only an Operations Manager of this company can review a version the Project Manager submitted, and never the person who submitted it or the person the task is assigned to. Leaving it unassigned keeps it in the Operations queue for any of them.">
      {(done) => (
        <ActionForm action={assignOutputReviewer} submitLabel="Save" onDone={(s) => done(s as Done)}>
          <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="versionId" value={versionId} />
          <Field label="Reviewer" htmlFor="ar-reviewer">
            <Select id="ar-reviewer" name="reviewerId" defaultValue={current}>
              <option value="">Anyone eligible (keep in the Operations queue)</option>
              {eligible.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </Field>
          {eligible.length === 0 ? <p className="text-[13px] text-muted-foreground">Nobody is eligible yet. Someone with access to People &amp; Access can give the Operations role to another person.</p> : null}
        </ActionForm>
      )}
    </FormDialog>
  );
}
