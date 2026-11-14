/**
 * The "open this version" lines on My Work: for a filter that is about an output (Waiting for review, Changes requested, Waiting for my review), one line per task naming the version and
 * linking straight to it. Pure; the versions come from the one bounded lookup in `loadWorkRows`, so a row without a matching version simply has no line.
 */
import type { OutputRef } from "./my-work";

export type OutputLinkKind = "waiting" | "changes" | "review";
export interface OutputLinkLine { taskId: string; versionId: string; title: string; context: string; text: string; href: string }

const WANT: Record<OutputLinkKind, OutputRef["status"]> = { waiting: "awaiting", review: "awaiting", changes: "changes_requested" };
const TEXT: Record<OutputLinkKind, (n: number) => string> = {
  waiting: (n) => `Version ${n} is waiting for review`,
  review: (n) => `Version ${n} is waiting for your review`,
  changes: (n) => `Changes were requested on version ${n}: upload a new one`,
};

export function outputLinkLines(
  kind: OutputLinkKind, rows: readonly { id: string; title: string; projectName: string; projectReference: string }[], outputs: Readonly<Record<string, OutputRef>>, hrefFor: (taskId: string, versionId: string) => string,
): OutputLinkLine[] {
  const out: OutputLinkLine[] = [];
  for (const r of rows) {
    const ref = outputs[r.id];
    if (!ref || ref.status !== WANT[kind]) continue;
    out.push({ taskId: r.id, versionId: ref.versionId, title: r.title, context: `${r.projectReference} ${r.projectName}`, text: TEXT[kind](ref.versionNo), href: hrefFor(r.id, ref.versionId) });
  }
  return out;
}
