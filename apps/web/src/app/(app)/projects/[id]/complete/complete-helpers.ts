import { completionActionsFor, type CompletionItemKind } from "@enginious-hr/domain";
import type { ProjCompletionReviewRow } from "@/types/projects";

/** Pure helpers for the completion flow: nothing becomes Done by completing a project; every unfinished item needs an explicit decision and a reason. */

export interface Choice {
  action: string;
  note: string;
}
export type Choices = Record<string, Choice>;
export interface Resolution {
  kind: CompletionItemKind;
  id: string;
  action: string;
  note: string;
}

export const itemKey = (i: Pick<ProjCompletionReviewRow, "kind" | "item_id">) => `${i.kind}:${i.item_id}`;

const isComplete = (kind: CompletionItemKind, c: Choice | undefined) =>
  Boolean(c && c.note.trim().length > 0 && completionActionsFor(kind).some((a) => a.id === c.action));

/** The payload for completeProject: only items with a valid action and a reason, in review order. */
export function buildResolutions(items: readonly ProjCompletionReviewRow[], choices: Choices): Resolution[] {
  return items.flatMap((i) => {
    const c = choices[itemKey(i)];
    return isComplete(i.kind, c) ? [{ kind: i.kind, id: i.item_id, action: c!.action, note: c!.note.trim() }] : [];
  });
}

/** Items still lacking a valid action or a reason. */
export function unresolvedItems(items: readonly ProjCompletionReviewRow[], choices: Choices): ProjCompletionReviewRow[] {
  return items.filter((i) => !isComplete(i.kind, choices[itemKey(i)]));
}

/** Applies one action and reason to every item of a kind (a shortcut; each item can still be changed). Invalid actions for the kind are skipped. */
export function applyToKind(items: readonly ProjCompletionReviewRow[], choices: Choices, kind: CompletionItemKind, choice: Choice): Choices {
  const next = { ...choices };
  if (!completionActionsFor(kind).some((a) => a.id === choice.action)) return next;
  for (const i of items) if (i.kind === kind) next[itemKey(i)] = { ...choice };
  return next;
}

export interface EvidenceInput {
  projectKind: "client" | "internal";
  evidenceType: string;
  evidenceReference: string;
  fileId: string;
  confirmedOn: string;
  clientContact: string;
  note: string;
  today: string;
}

/** What is still missing from the evidence section, in words. Empty means ready to send (the database re-checks everything). */
export function evidenceProblems(e: EvidenceInput): string[] {
  const out: string[] = [];
  if (!e.note.trim()) out.push("Write the completion note.");
  if (e.projectKind === "internal") return out;
  if (!["email_reference", "signed_handover", "uploaded_confirmation"].includes(e.evidenceType)) out.push("Choose the kind of client confirmation.");
  else if (e.evidenceType === "uploaded_confirmation" ? !e.fileId : !e.evidenceReference.trim()) out.push(e.evidenceType === "uploaded_confirmation" ? "Choose the uploaded confirmation file." : "Give the reference of the client's confirmation.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.confirmedOn)) out.push("Give the date the client confirmed.");
  else if (e.confirmedOn > e.today) out.push("The confirmation date cannot be in the future.");
  if (!e.clientContact.trim()) out.push("Record who at the client confirmed.");
  return out;
}
