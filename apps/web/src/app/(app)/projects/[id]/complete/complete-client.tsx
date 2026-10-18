"use client";

import { startTransition, useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { COMPLETION_EVIDENCE_TYPES, completionActionsFor, type CompletionItemKind } from "@enginious-hr/domain";
import { completeProject } from "@/lib/actions/projectsClose";
import type { ProjectActionState } from "@/lib/projects/action-utils";
import type { ProjCompletionReviewRow } from "@/types/projects";
import { Field } from "@/components/sales/action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { applyToKind, buildResolutions, evidenceProblems, itemKey, unresolvedItems, type Choices } from "./complete-helpers";

const KIND_TITLES: Record<CompletionItemKind, string> = {
  task: "Unfinished tasks", deliverable: "Open deliverables", milestone: "Milestones not accepted", feedback: "Client feedback still open", booking: "Upcoming site bookings",
};
const KIND_ORDER: CompletionItemKind[] = ["task", "deliverable", "milestone", "feedback", "booking"];
const EXPLAIN: Record<CompletionItemKind, string> = {
  task: "Cancel it, or defer it (it stays on the project as deferred work).", deliverable: "Cancel it, or defer it.", milestone: "Cancel it, or defer it.",
  feedback: "Resolve it, decline it, or defer it, and say how.", booking: "A booking that has not happened is cancelled.",
};

interface Props {
  projectId: string;
  projectKind: "client" | "internal";
  items: ProjCompletionReviewRow[];
  evidenceFiles: { id: string; label: string }[];
  today: string;
}

export function CompleteClient({ projectId, projectKind, items, evidenceFiles, today }: Props) {
  const router = useRouter();
  const [choices, setChoices] = useState<Choices>({});
  const [bulk, setBulk] = useState<Record<string, { action: string; note: string }>>({});
  const [evidence, setEvidence] = useState({ evidenceType: "", evidenceReference: "", fileId: "", confirmedOn: "", clientContact: "", note: "" });
  const [state, formAction, pending] = useActionState<ProjectActionState, FormData>(async (_prev, fd) => completeProject(_prev, fd), { error: null });

  const unresolved = useMemo(() => unresolvedItems(items, choices), [items, choices]);
  const resolutions = useMemo(() => buildResolutions(items, choices), [items, choices]);
  const problems = useMemo(() => evidenceProblems({ projectKind, ...evidence, today }), [projectKind, evidence, today]);
  const ready = unresolved.length === 0 && problems.length === 0;

  useEffect(() => {
    if (state.error === null && state.id) {
      router.push(`/projects/${projectId}`);
      router.refresh();
    }
  }, [state, router, projectId]);

  const setChoice = (key: string, patch: Partial<{ action: string; note: string }>) => setChoices((c) => ({ ...c, [key]: { action: c[key]?.action ?? "", note: c[key]?.note ?? "", ...patch } }));
  const grouped = KIND_ORDER.map((k) => ({ kind: k, rows: items.filter((i) => i.kind === k) })).filter((g) => g.rows.length > 0);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      className="space-y-6"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="resolutions" value={JSON.stringify(resolutions)} />

      <section aria-labelledby="unfinished" className="space-y-4">
        <h2 id="unfinished" className="text-base font-semibold">1. Unfinished work</h2>
        {items.length === 0 ? (
          <Alert role="status">Nothing is unfinished: no open tasks, deliverables, milestones, client feedback or upcoming site bookings. You can go straight to the evidence.</Alert>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Completing the project does not mark anything Done. Every item below needs an explicit decision and a reason, so nothing is closed silently. Deferred items stay on the project; cancelled ones are kept in the history.</p>
            {grouped.map((g) => {
              const actions = completionActionsFor(g.kind);
              const b = bulk[g.kind] ?? { action: "", note: "" };
              return (
                <div key={g.kind} className="rounded-md border border-border">
                  <div className="space-y-2 border-b border-border px-3 py-2">
                    <h3 className="text-sm font-semibold">{KIND_TITLES[g.kind]} ({g.rows.length})</h3>
                    <p className="text-sm text-muted-foreground">{EXPLAIN[g.kind]}</p>
                    {g.rows.length > 1 ? (
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="w-full sm:w-44">
                          <label htmlFor={`bulk-a-${g.kind}`} className="sr-only">Decision for all {KIND_TITLES[g.kind].toLowerCase()}</label>
                          <Select id={`bulk-a-${g.kind}`} value={b.action} onChange={(e) => setBulk((x) => ({ ...x, [g.kind]: { ...b, action: e.target.value } }))}>
                            <option value="">Same decision for all…</option>
                            {actions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                          </Select>
                        </div>
                        <div className="min-w-0 flex-1 sm:min-w-56">
                          <label htmlFor={`bulk-n-${g.kind}`} className="sr-only">Reason for all</label>
                          <Input id={`bulk-n-${g.kind}`} value={b.note} onChange={(e) => setBulk((x) => ({ ...x, [g.kind]: { ...b, note: e.target.value } }))} placeholder="Reason for all" />
                        </div>
                        <Button type="button" size="sm" variant="outline" disabled={!b.action || !b.note.trim()} onClick={() => setChoices((c) => applyToKind(items, c, g.kind, b))}>Apply to all</Button>
                      </div>
                    ) : null}
                  </div>
                  <ul className="divide-y divide-border">
                    {g.rows.map((i) => {
                      const key = itemKey(i);
                      const c = choices[key] ?? { action: "", note: "" };
                      const done = unresolved.every((u) => itemKey(u) !== key);
                      return (
                        <li key={key} className="space-y-2 px-3 py-3">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-sm font-medium break-words">{i.title}</span>
                            <span className="text-sm text-muted-foreground">{i.status.replace(/_/g, " ")}{i.detail ? ` · ${i.detail}` : ""}</span>
                            {done ? <span className="text-[13px] text-emerald-800 dark:text-emerald-300">Decided</span> : <span className="text-[13px] text-amber-800 dark:text-amber-300">Needs a decision</span>}
                          </div>
                          <div className="grid gap-2 sm:grid-cols-[12rem_1fr]">
                            <div>
                              <label htmlFor={`a-${key}`} className="sr-only">Decision for {i.title}</label>
                              <Select id={`a-${key}`} value={c.action} onChange={(e) => setChoice(key, { action: e.target.value })}>
                                <option value="">Choose…</option>
                                {actions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                              </Select>
                            </div>
                            <div>
                              <label htmlFor={`n-${key}`} className="sr-only">Reason for {i.title}</label>
                              <Input id={`n-${key}`} value={c.note} onChange={(e) => setChoice(key, { note: e.target.value })} placeholder="Reason (required)" />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </>
        )}
      </section>

      <section aria-labelledby="evidence" className="space-y-4">
        <h2 id="evidence" className="text-base font-semibold">2. {projectKind === "client" ? "The client's completion confirmation" : "Completion note"}</h2>
        {projectKind === "client" ? (
          <>
            <p className="text-sm text-muted-foreground">A client project cannot be completed without the client confirming completion. Record where that confirmation is; the app does not contact the client.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Kind of confirmation" htmlFor="ev-type">
                <Select id="ev-type" name="evidenceType" value={evidence.evidenceType} onChange={(e) => setEvidence({ ...evidence, evidenceType: e.target.value })} required>
                  <option value="" disabled>Choose…</option>
                  {COMPLETION_EVIDENCE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </Select>
              </Field>
              <Field label="Date the client confirmed" htmlFor="ev-date" hint="Not in the future.">
                <Input id="ev-date" name="confirmedOn" type="date" max={today} value={evidence.confirmedOn} onChange={(e) => setEvidence({ ...evidence, confirmedOn: e.target.value })} required />
              </Field>
            </div>
            {evidence.evidenceType === "uploaded_confirmation" ? (
              <Field label="Uploaded confirmation" htmlFor="ev-file" hint="Only files added to Documents as “Completion evidence” can be chosen.">
                <Select id="ev-file" name="fileId" value={evidence.fileId} onChange={(e) => setEvidence({ ...evidence, fileId: e.target.value })}>
                  <option value="">{evidenceFiles.length === 0 ? "No completion evidence uploaded yet" : "Choose…"}</option>
                  {evidenceFiles.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </Select>
                <p className="mt-1 text-sm"><Link className="underline" href={`/projects/${projectId}/documents`}>Upload it in Documents</Link>, then come back (your decisions above are kept while this page stays open).</p>
              </Field>
            ) : evidence.evidenceType ? (
              <Field label={COMPLETION_EVIDENCE_TYPES.find((t) => t.id === evidence.evidenceType)?.label ?? "Reference"} htmlFor="ev-ref" hint={COMPLETION_EVIDENCE_TYPES.find((t) => t.id === evidence.evidenceType)?.hint}>
                <Input id="ev-ref" name="evidenceReference" value={evidence.evidenceReference} onChange={(e) => setEvidence({ ...evidence, evidenceReference: e.target.value })} required />
              </Field>
            ) : null}
            <Field label="Who at the client confirmed" htmlFor="ev-contact"><Input id="ev-contact" name="clientContact" value={evidence.clientContact} onChange={(e) => setEvidence({ ...evidence, clientContact: e.target.value })} placeholder="Name and company" required /></Field>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">An internal project needs no client confirmation: the owner records what was delivered.</p>
        )}
        <Field label={projectKind === "client" ? "Project Manager's completion note" : "Owner's completion note"} htmlFor="ev-note">
          <Textarea id="ev-note" name="completionNote" rows={4} value={evidence.note} onChange={(e) => setEvidence({ ...evidence, note: e.target.value })} required />
        </Field>
      </section>

      {state.error ? <Alert variant="destructive" role="alert">{state.error}</Alert> : null}
      {!ready ? (
        <div role="status" className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
          <p className="font-medium">Before you can complete the project:</p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {unresolved.length > 0 ? <li>{unresolved.length} item{unresolved.length === 1 ? "" : "s"} still need a decision and a reason.</li> : null}
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Link href={`/projects/${projectId}`} className="text-sm underline">Cancel</Link>
        <Button type="submit" disabled={!ready || pending}>{pending ? "Completing…" : "Complete project"}</Button>
      </div>
    </form>
  );
}
