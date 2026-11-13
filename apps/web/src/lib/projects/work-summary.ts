import { registerCounts, type Register, type RegisterFilter } from "@/lib/projects/phase2/model";

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
export const outputSummary = (reg: Register | null): OutputSummary | null => (reg ? { total: reg.rows.length, counts: registerCounts(reg.rows) } : null);
