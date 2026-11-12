"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { approveCloseout, discardCloseoutDraft, generateCloseout, saveCloseoutEdits } from "@/lib/actions/projectsCloseout";
import { ActionForm } from "@/components/sales/action-form";
import { Muted, Panel } from "@/components/projects/parts";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/projects/format";
import { reviewSummary, type EvidenceItem } from "@/lib/projects/closeout/evidence";
import { BLOCKING_FLAGS, FLAG_WORDS, MAX_PARAGRAPH_CHARS, sourceHref, type ReportSection, type ReportView } from "@/lib/projects/closeout/report";
import { cn } from "@/lib/utils";

/**
 * The Closeout report workspace, for whoever manages the project.
 *   1. "Review data to be sent": exactly what would go to the AI provider (Anthropic): the source categories, the team names, and each optional text, which the Project
 *      Manager can remove. Nothing is sent until they press the button that says so. A facts-only draft sends nothing.
 *   2. The draft: recorded facts at the top (from the records, not editable), then the narrative, every paragraph with its source references and anything to check.
 *   3. Approve: the explicit step that fixes a version. Only an approved version can be downloaded. Nothing here is sent to the client, completes the project or
 *      changes stock.
 */
type Done = { error: string | null; notice?: string | null };

export function CloseoutWorkspace({ projectId, items, team, missing, defaultInclude, draft, approved, provider }: {
  projectId: string; items: EvidenceItem[]; team: { name: string }[]; missing: string[]; defaultInclude: string[];
  draft: ReportView | null; approved: ReportView[]; provider: { available: boolean; kind: "anthropic" | "simulated" | "none"; note: string | null };
}) {
  const [reviewing, setReviewing] = useState(!draft);
  const [notice, setNotice] = useState<string | null>(null);
  const done = (s: Done) => { setNotice(s.notice ?? null); if (!s.error) setReviewing(false); };
  return (
    <div className="space-y-6">
      {notice ? <Alert role="status" data-testid="closeout-notice">{notice}</Alert> : null}
      {draft && !reviewing ? (
        <DraftEditor key={`${draft.id}-${draft.version}`} projectId={projectId} draft={draft} onNotice={setNotice} onReview={() => { setNotice(null); setReviewing(true); }} />
      ) : (
        <Review projectId={projectId} items={items} team={team} missing={missing} initial={draft ? draft.include : defaultInclude} hasDraft={!!draft} provider={provider} onDone={done}
          onCancel={draft ? () => setReviewing(false) : undefined} />
      )}
      <Panel title="Approved versions" description="An approved version is fixed: it keeps the evidence it was written from, so later changes to the project do not rewrite it.">
        {approved.length === 0 ? <Muted>No version has been approved yet. A report can be downloaded once it is approved.</Muted> : (
          <ul className="space-y-3" data-testid="closeout-approved">
            {approved.map((r) => (
              <li key={r.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Version {r.versionNo}</span>
                  <span className="text-[13px] text-muted-foreground">approved {r.approvedAt ? formatDateTime(r.approvedAt) : ""}{r.approvedBy ? ` by ${r.approvedBy}` : ""}; evidence taken {formatDateTime(r.snapshotAt)}</span>
                  <a className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto")} href={`/projects/${projectId}/closeout/${r.id}/pdf`} target="_blank" rel="noreferrer">
                    <Download className="mr-1 h-4 w-4" aria-hidden /> Download PDF
                  </a>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[13px] text-accent">Read version {r.versionNo}</summary>
                  <div className="mt-3"><ReportBody projectId={projectId} report={r} /></div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Review({ projectId, items, team, missing, initial, hasDraft, provider, onDone, onCancel }: {
  projectId: string; items: EvidenceItem[]; team: { name: string }[]; missing: string[]; initial: string[]; hasDraft: boolean;
  provider: { available: boolean; kind: string; note: string | null }; onDone: (s: Done) => void; onCancel?: () => void;
}) {
  const [include, setInclude] = useState<Set<string>>(() => new Set(initial));
  const selection = useMemo(() => ({ include: [...include].sort() }), [include]);
  const summary = useMemo(() => reviewSummary(items, selection, { team, missing } as never), [items, selection, team, missing]);
  const toggle = (key: string) => setInclude((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const hidden = <><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="include" value={JSON.stringify(selection.include)} /><input type="hidden" name="reviewedHash" value={summary.hash} /></>;
  return (
    <Panel title="Review data to be sent" description="This is what the report would be written from. Check it, remove any optional text you do not want to include, then choose how to write the draft.">
      <div className="space-y-5" data-testid="closeout-review">
        {missing.length > 0 ? <Alert variant="destructive" role="alert" data-testid="closeout-missing"><strong>Some records could not be read.</strong> The report will say so where it matters: {missing.join("; ")}.</Alert> : null}
        <section>
          <h3 className="text-sm font-semibold">Source categories</h3>
          <ul className="mt-2 grid gap-1 text-[13px] sm:grid-cols-2" data-testid="closeout-categories">
            {summary.categories.map((c) => <li key={c.category}>{c.label} <span className="text-muted-foreground">({c.lines} line{c.lines === 1 ? "" : "s"})</span></li>)}
          </ul>
          <Muted className="mt-2">Never included: prices, costs, margins, budgets, payroll, project chat, task comments, files and attachments, contact details.</Muted>
        </section>
        <section>
          <h3 className="text-sm font-semibold">Team members named</h3>
          <p className="mt-1 text-[13px]" data-testid="closeout-team">{summary.teamNames.length > 0 ? summary.teamNames.join(", ") : "Nobody"}</p>
          <Muted className="mt-1">Names and project roles only, with what the records show each person owned. No contact or employee details, and no judgement of effort or performance.</Muted>
        </section>
        <section>
          <h3 className="text-sm font-semibold">Optional text ({summary.optional.filter((o) => o.selected).length} of {summary.optional.length} included)</h3>
          <Muted className="mt-1">Text that people wrote. Untick anything you do not want to include. Client feedback, our response and notes are left out unless you tick them.</Muted>
          {summary.optional.length === 0 ? <Muted className="mt-2">There is no optional text on this project.</Muted> : (
            <ul className="mt-2 space-y-2" data-testid="closeout-optional">
              {summary.optional.map((o) => (
                <li key={o.key} className="rounded-md border p-2">
                  <label className="flex items-start gap-2 text-[13px]">
                    <input type="checkbox" className="mt-1" checked={o.selected} onChange={() => toggle(o.key)} data-testid={`closeout-opt-${o.key}`} />
                    <span><span className="font-medium">{o.label}</span><span className="mt-0.5 block whitespace-pre-wrap text-muted-foreground">{o.text}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
        {summary.withheld.length > 0 ? (
          <Alert role="status" data-testid="closeout-withheld">
            <strong>Kept inside Enginious OS by the data policy ({summary.withheld.length}):</strong>
            <ul className="mt-1 list-disc pl-5">{summary.withheld.map((w) => <li key={w.ref}>{w.label}: {w.why}</li>)}</ul>
          </Alert>
        ) : null}
        {summary.dropped.length > 0 ? <Alert role="status">This project has more records than one report can take. {summary.dropped.length} line{summary.dropped.length === 1 ? " is" : "s are"} left out to keep the size bounded (optional text and the longest lists first). The status, sign-off and equipment lines are always kept.</Alert> : null}
        <details>
          <summary className="cursor-pointer text-[13px] text-accent">Show every line ({summary.chars.toLocaleString("en-GB")} characters)</summary>
          <ol className="mt-2 space-y-1 text-[12px]" data-testid="closeout-lines">
            {items.filter((x) => !x.withheld && !summary.dropped.includes(x.ref) && (!x.optional || include.has(x.optional.key))).map((x) => <li key={x.ref}><span className="font-mono text-muted-foreground">[{x.ref}]</span> {x.text}</li>)}
          </ol>
        </details>
        {hasDraft ? <Alert role="status">Writing the draft again replaces the current draft, including your edits. Approved versions are not affected.</Alert> : null}
        <div className="rounded-md border border-[hsl(var(--os-amber)/0.5)] bg-[hsl(var(--os-amber)/0.08)] p-3 text-[13px]" data-testid="closeout-anthropic-note">
          <strong>Generating sends the reviewed content above to Anthropic</strong>, the AI provider Enginious OS uses, to write the narrative. Nothing else is sent. The result is an internal draft
          for you to edit: nothing is sent to the client, the project is not completed, and no work or stock changes.
        </div>
        <div className="flex flex-wrap items-start gap-3">
          {provider.available ? (
            <ActionForm action={generateCloseout} submitLabel="Send to Anthropic and write the draft" pendingLabel="Writing the draft… this can take up to a minute" onDone={(s) => onDone(s as Done)}>
              {hidden}<input type="hidden" name="mode" value="ai" />
            </ActionForm>
          ) : <Alert role="status" data-testid="closeout-no-provider">{provider.note} You can still write a facts-only draft.</Alert>}
          <ActionForm action={generateCloseout} variant="outline" submitLabel="Write a facts-only draft (nothing is sent)" pendingLabel="Writing…" onDone={(s) => onDone(s as Done)}>
            {hidden}<input type="hidden" name="mode" value="facts" />
          </ActionForm>
          {onCancel ? <Button type="button" variant="ghost" onClick={onCancel}>Back to the draft</Button> : null}
        </div>
        {provider.kind === "simulated" ? <Muted>This environment uses the simulated provider: nothing leaves Enginious OS here.</Muted> : null}
      </div>
    </Panel>
  );
}

function KeyFacts({ report }: { report: ReportView }) {
  return (
    <div data-testid="closeout-facts">
      <h3 className="text-sm font-semibold">Recorded facts</h3>
      <Muted>From the project&apos;s records as they were on {formatDateTime(report.snapshotAt)}. These are not written by the AI model and cannot be edited here.</Muted>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
        {report.facts.map((f) => (
          <div key={f.label} className="flex gap-2">
            <dt className="w-40 shrink-0 text-muted-foreground">{f.label}</dt>
            <dd className={cn(f.attention && "font-medium text-[hsl(var(--os-amber))]")}>{f.value}</dd>
          </div>
        ))}
      </dl>
      {report.missing.length > 0 ? <Alert variant="destructive" role="alert" className="mt-2">Could not be read when this was written: {report.missing.join("; ")}.</Alert> : null}
    </div>
  );
}

function Sources({ projectId, report, cited }: { projectId: string; report: ReportView; cited: Set<string> }) {
  const rows = report.refs.filter((r) => cited.has(r.ref));
  if (rows.length === 0) return null;
  return (
    <section data-testid="closeout-sources">
      <h3 className="text-sm font-semibold">Sources</h3>
      <ul className="mt-2 space-y-1 text-[12px]">
        {rows.map((r) => (
          <li key={r.ref} id={`src-${report.id}-${r.ref}`}>
            <span className="font-mono text-muted-foreground">[{r.ref}]</span>{" "}
            <Link href={sourceHref(projectId, r)} className="text-accent underline-offset-4 hover:underline">{r.label}</Link>: {r.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A fixed (approved) version, read only. */
function ReportBody({ projectId, report }: { projectId: string; report: ReportView }) {
  const cited = new Set(report.sections.flatMap((s) => s.paragraphs.flatMap((p) => p.refs)));
  return (
    <div className="space-y-4">
      <KeyFacts report={report} />
      {report.sections.map((s) => (
        <section key={s.id}>
          <h3 className="text-sm font-semibold">{s.title}</h3>
          {s.paragraphs.length === 0 ? <Muted>Nothing written.</Muted> : s.paragraphs.map((p, i) => (
            <p key={i} className="mt-1 whitespace-pre-wrap text-[13px]">{p.text} {p.refs.map((r) => <a key={r} href={`#src-${report.id}-${r}`} className="font-mono text-[11px] text-accent">[{r}]</a>)}</p>
          ))}
        </section>
      ))}
      <Sources projectId={projectId} report={report} cited={cited} />
    </div>
  );
}

function DraftEditor({ projectId, draft, onNotice, onReview }: { projectId: string; draft: ReportView; onNotice: (n: string | null) => void; onReview: () => void }) {
  const [sections, setSections] = useState<ReportSection[]>(() => draft.sections.map((s) => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, refs: [...p.refs], flags: [...p.flags] })) })));
  const [dirty, setDirty] = useState(false);
  const known = useMemo(() => new Set(draft.refs.map((r) => r.ref)), [draft.refs]);
  const change = (sid: string, fn: (ps: ReportSection["paragraphs"]) => ReportSection["paragraphs"]) => { setDirty(true); setSections((prev) => prev.map((s) => (s.id === sid ? { ...s, paragraphs: fn(s.paragraphs) } : s))); };
  const cited = new Set(sections.flatMap((s) => s.paragraphs.flatMap((p) => p.refs)));
  const blocking = draft.sections.flatMap((s) => s.paragraphs.flatMap((p) => p.flags.filter((f) => BLOCKING_FLAGS.includes(f)))).length;
  const toCheck = draft.sections.flatMap((s) => s.paragraphs.flatMap((p) => p.flags.filter((f) => !BLOCKING_FLAGS.includes(f) && f !== "suggestion"))).length;
  const empty = sections.every((s) => s.paragraphs.every((p) => !p.text.trim()));
  return (
    <Panel title={`Draft, version ${draft.versionNo}`}
      description={draft.generation === "generated" ? "Written by the AI model from the content you reviewed. It is a draft: check it against the sources, edit it, then approve it." : "A facts-only draft: the recorded lines themselves. Nothing was sent to the AI provider. Edit it, then approve it."}
      actions={<Badge variant="outline">Internal draft</Badge>}>
      <div className="space-y-5" data-testid="closeout-draft">
        <KeyFacts report={draft} />
        {blocking > 0 ? <Alert variant="destructive" role="alert" data-testid="closeout-blocking">{blocking} statement{blocking === 1 ? "" : "s"} contradict{blocking === 1 ? "s" : ""} the project&apos;s records. Change {blocking === 1 ? "it" : "them"} and save before approving.</Alert> : null}
        {sections.map((s) => (
          <section key={s.id} data-testid={`closeout-section-${s.id}`}>
            <h3 className="text-sm font-semibold">{s.title}</h3>
            {s.paragraphs.length === 0 ? <Muted>Nothing written yet.</Muted> : null}
            <div className="mt-2 space-y-3">
              {s.paragraphs.map((p, i) => (
                <div key={i} className={cn("rounded-md border p-2", p.flags.some((f) => BLOCKING_FLAGS.includes(f)) && "border-destructive")}>
                  <label className="sr-only" htmlFor={`co-${s.id}-${i}`}>{s.title}, paragraph {i + 1}</label>
                  <Textarea id={`co-${s.id}-${i}`} rows={Math.min(8, Math.max(2, Math.ceil(p.text.length / 110)))} maxLength={MAX_PARAGRAPH_CHARS} value={p.text}
                    onChange={(e) => change(s.id, (ps) => ps.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} />
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px]">
                    <label htmlFor={`co-${s.id}-${i}-refs`} className="text-muted-foreground">Sources</label>
                    <Input id={`co-${s.id}-${i}-refs`} className="h-7 w-48 text-[12px]" value={p.refs.join(", ")} placeholder="for example S4, S12"
                      onChange={(e) => change(s.id, (ps) => ps.map((x, k) => (k === i ? { ...x, refs: e.target.value.split(/[\s,]+/).map((r) => r.trim().toUpperCase()).filter(Boolean) } : x)))} />
                    {p.refs.filter((r) => !known.has(r)).length > 0 ? <span className="text-destructive">Not a source of this report: {p.refs.filter((r) => !known.has(r)).join(", ")}</span> : null}
                    <Button type="button" variant="ghost" size="sm" className="ml-auto h-7" onClick={() => change(s.id, (ps) => ps.filter((_, k) => k !== i))}>Remove paragraph</Button>
                  </div>
                  {p.flags.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-[12px]" data-testid="closeout-flags">
                      {p.flags.map((f) => <li key={f} className={BLOCKING_FLAGS.includes(f) ? "text-destructive" : "text-[hsl(var(--os-amber))]"}>{FLAG_WORDS[f]}</li>)}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => change(s.id, (ps) => [...ps, { text: "", refs: [], flags: [] }])}>Add paragraph</Button>
          </section>
        ))}
        <Sources projectId={projectId} report={draft} cited={cited} />
        <details>
          <summary className="cursor-pointer text-[13px] text-accent">All {draft.refs.length} source lines of this draft</summary>
          <ol className="mt-2 space-y-1 text-[12px]">{draft.refs.map((r) => <li key={r.ref}><span className="font-mono text-muted-foreground">[{r.ref}]</span> {r.text}</li>)}</ol>
        </details>
        <div className="flex flex-wrap items-start gap-3 border-t pt-4">
          <ActionForm action={saveCloseoutEdits} submitLabel="Save edits" disabled={!dirty} onDone={(s) => { setDirty(false); onNotice((s as Done).notice ?? null); }}>
            <input type="hidden" name="reportId" value={draft.id} /><input type="hidden" name="expectedVersion" value={draft.version} /><input type="hidden" name="sections" value={JSON.stringify(sections)} />
          </ActionForm>
          <ActionForm action={approveCloseout} submitLabel={`Approve version ${draft.versionNo}`} disabled={dirty || blocking > 0 || empty} onDone={(s) => onNotice((s as Done).notice ?? null)}>
            <input type="hidden" name="reportId" value={draft.id} /><input type="hidden" name="expectedVersion" value={draft.version} />
            {toCheck > 0 ? <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" name="checked" className="mt-1" data-testid="closeout-checked" /> I have checked the {toCheck} statement{toCheck === 1 ? "" : "s"} marked to check.</label> : null}
            <Muted>{dirty ? "Save your edits before approving." : "Approving fixes this version so it can be downloaded. It sends nothing to anyone and does not complete the project."}</Muted>
          </ActionForm>
          <Button type="button" variant="outline" onClick={onReview}>Review data and write again</Button>
          <ActionForm action={discardCloseoutDraft} variant="outline" submitLabel="Discard draft" onDone={(s) => onNotice((s as Done).notice ?? null)}>
            <input type="hidden" name="reportId" value={draft.id} /><input type="hidden" name="projectId" value={projectId} />
          </ActionForm>
        </div>
      </div>
    </Panel>
  );
}
