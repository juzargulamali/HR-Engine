import { taskDonePrefix } from "./work-queues";
import { OUTPUT_STATE_LABELS, OUTPUT_STATE_TONE, registerCounts, reviewStateWord, type OutputState, type Register, type RegisterFilter } from "@/lib/projects/phase2/model";

/** The compact "Milestones" and "Task outputs" strip on Work: counts and one next step each, every number a link to the records behind it. Pure. */
export interface MilestoneLite { id: string; title: string; status: string; due_date: string | null; is_required: boolean }
export interface MilestoneSummary { total: number; accepted: number; open: number; overdue: number; next: { id: string; title: string; due: string | null; status: string } | null }

export function milestoneSummary(ms: readonly MilestoneLite[], today: string): MilestoneSummary {
  const live = ms.filter((m) => m.status !== "cancelled");
  const open = live.filter((m) => m.status !== "accepted");
  const next = [...open].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.title.localeCompare(b.title))[0] ?? null;
  return {
    total: live.length, accepted: live.length - open.length, open: open.length, overdue: open.filter((m) => !!m.due_date && m.due_date < today).length,
    next: next ? { id: next.id, title: next.title, due: next.due_date, status: next.status } : null,
  };
}

export interface OutputSummary { total: number; counts: Record<RegisterFilter, number> }
export const outputSummary = (reg: Register | null, userId = ""): OutputSummary | null => (reg ? { total: reg.rows.length, counts: registerCounts(reg.rows, userId) } : null);

/** What most needs a person first: changes asked for, then versions waiting for review, then missing or short outputs, then approved ones last. */
const ATTENTION_ORDER: Record<OutputState, number> = { changes_requested: 0, awaiting_review: 1, missing: 2, partial: 3, approved: 4 };

/** One real expected output on Work: the task, what it must produce, its state in words (naming the reviewer for an Operations review) and a link straight to the version. */
export interface OutputLine { taskId: string; title: string; output: string; state: OutputState; stateText: string; tone: "red" | "amber" | "blue" | "green"; version: number | null; href: string; assignee: string | null }

export function outputLines(reg: Register | null, projectId: string, limit = 6): { lines: OutputLine[]; more: number } {
  if (!reg) return { lines: [], more: 0 };
  const sorted = [...reg.rows].sort((a, b) => ATTENTION_ORDER[a.state] - ATTENTION_ORDER[b.state] || (a.task_due ?? "9999").localeCompare(b.task_due ?? "9999") || a.task_title.localeCompare(b.task_title));
  const lines = sorted.slice(0, limit).map((r): OutputLine => {
    const cur = r.current;
    const base = cur && (r.state === "awaiting_review" || r.state === "changes_requested" || r.state === "approved") ? reviewStateWord(cur) : OUTPUT_STATE_LABELS[r.state];
    // A task handed in whose output still waits: "Task done · Awaiting Operations review · Lena", so the task and the output are never read as one status.
    const stateText = r.state === "awaiting_review" || r.state === "missing" || r.state === "partial" ? `${taskDonePrefix(r.task_status)}${base}` : base;
    return {
      taskId: r.task_id, title: r.task_title, output: r.output_label, state: r.state, stateText, tone: OUTPUT_STATE_TONE[r.state], version: cur ? cur.version_no : null,
      href: `/projects/${projectId}/work?task=${r.task_id}${cur ? `&version=${cur.id}` : ""}`, assignee: r.assignee_name,
    };
  });
  return { lines, more: Math.max(0, sorted.length - lines.length) };
}
