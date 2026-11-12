import { handoverHref } from "@/lib/projects/handover-list";
import type { LucideIcon } from "lucide-react";
import { BadgeCheck, CalendarClock, ClipboardCheck, ClipboardList, FileCheck2, FileClock, FolderKanban, IdCard, Inbox, AlarmClock, ReceiptText, ShieldCheck } from "lucide-react";
import { HANDOVER_KIND_LABEL } from "@/lib/crm/handover-attention";
import type { HandoverCheck } from "@/lib/crm/handover-attention-data";
import type { ApprovalsWaiting, SalesToday } from "@/lib/crm/my-day";
import type { PendingApprovalItem } from "@/lib/approvals/pending";
import type { BudgetDay } from "@/lib/budget/my-day";
import type { WaitingNotesLoad } from "@/lib/inventory/project-notes-data";
import { projectNotesHref } from "@/lib/inventory/project-notes";
import type { ProjectsAttention } from "@/lib/projects/my-work";
import { waitingAgeText } from "./waiting";

/**
 * "What needs my attention" on My Day, built in ONE place.
 *
 * Every source (approvals, project tasks, handovers, scope decisions, Sales follow-ups, budgets, dispatch and return notes, HR alerts) turns what it loaded into
 * candidates, one per record the person can act on. `buildAttention` merges them into ONE ordered list. The headline number is the length of that list and the
 * list on the page is that same list: there is no second count anywhere, so the two cannot disagree. A record that two sources both reach has the same key
 * and is listed once. "Waiting on others" (what the person submitted themselves) is a different list and is never counted here.
 */

export type AttentionSource =
  | "approvals" | "project-tasks" | "project-decisions" | "sales" | "sales-handover" | "sales-approvals" | "budgets" | "budget-projects" | "notes" | "hr" | "operations" | "project-equipment";

/** Named in the headline and in the error entries when that source could not be loaded. */
export const SOURCE_LABEL: Record<AttentionSource, string> = {
  approvals: "Approvals",
  "project-tasks": "Project tasks",
  "project-decisions": "Project handovers and scope decisions",
  sales: "Sales follow-ups, handovers and approvals",
  "sales-handover": "Sales handovers",
  "sales-approvals": "Commercial approvals",
  budgets: "Project budgets",
  "budget-projects": "The budgets of your projects",
  notes: "Dispatch and return notes",
  hr: "People & HR alerts",
  operations: "Operations",
  "project-equipment": "Equipment bookings to review",
};

/** 0: overdue or past due. 1: due today. 2: everything else (ordered by how long it has waited). */
export type AttentionTier = 0 | 1 | 2;

export interface AttentionCandidate {
  /** The underlying record, stable across sources: `task:<id>`, `opp:<id>`, `budget:<versionId>`, `approval:<type>:<id>`, ... Two candidates with one key are one item. */
  key: string;
  source: AttentionSource;
  icon: LucideIcon;
  /** The record: its title or number ("Install LED wall", "Leave request: Aisha Khan", "DN-00012"). */
  title: string;
  /** What the person has to do about it ("Overdue task", "Waiting for your decision"). */
  what: string;
  /** Which project, person or enquiry it belongs to. */
  context?: string;
  /** How late or how long it has waited ("Overdue since 28 Oct", "Due today", "Waiting 3 days"). */
  when?: string;
  tier: AttentionTier;
  /** What orders the item inside its tier, oldest first: the due date, or the moment the wait began. Null sorts last. */
  at: string | null;
  href: string;
  /** Only for a row that stands for several records on one screen (the HR alerts): how many. */
  records?: number;
}

export interface AttentionItem extends AttentionCandidate {
  /** The other things asked about the same record, when two sources reach it ("Waiting for your review" on a task that is also overdue). */
  also: string[];
  sources: AttentionSource[];
}

export type AttentionSourceResult = { source: AttentionSource; status: "ok"; candidates: readonly AttentionCandidate[] } | { source: AttentionSource; status: "error" };

export interface AttentionError { source: AttentionSource; label: string }

export interface Attention {
  /** The one list. Its length is the headline number. */
  items: readonly AttentionItem[];
  /** Every source that could not be loaded. While this is not empty the page never says that nothing needs attention. */
  errors: readonly AttentionError[];
  /** items.length, set from the list above in the same step (never counted separately). */
  count: number;
  headline: AttentionHeadline;
}

export interface AttentionHeadline {
  /** The words that link to the list; `prefix` and `suffix` surround it. `text` is all three. */
  prefix: string;
  link: string;
  suffix: string;
  text: string;
}

/** The id of the list on the page: the headline links here. */
export const ATTENTION_LIST_ID = "attention";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function attentionHeadline(itemCount: number, errors: readonly AttentionError[]): AttentionHeadline {
  const failed = errors.length > 0 ? `${errors.length} ${plural(errors.length, "part", "parts")} could not be loaded: ${errors.map((e) => e.label).join(", ")}` : "";
  let prefix = "";
  let link: string;
  let suffix: string;
  if (itemCount > 0) {
    prefix = "Your updates for today: ";
    link = `${itemCount} ${plural(itemCount, "item needs", "items need")} your attention`;
    suffix = failed ? `; ${failed}.` : ".";
  } else if (failed) {
    // Something could not be read, so "nothing needs attention" would be a guess.
    link = "Some items may need your attention";
    suffix = `: ${failed}, so this list may be incomplete.`;
  } else {
    link = "Nothing needs your attention right now.";
    suffix = "";
  }
  return { prefix, link, suffix, text: `${prefix}${link}${suffix}` };
}

const TIER_LABEL: Record<AttentionTier, string> = { 0: "overdue", 1: "due today", 2: "other" };
export const attentionTierLabel = (t: AttentionTier) => TIER_LABEL[t];

/**
 * Merges the sources into the one list. Order: overdue / past due first, then due today, then the rest; inside each, the oldest first (the due date, or when the wait
 * began), then by key so the order never flickers. Candidates with the same key become one item: the most urgent candidate leads (and supplies the link), the others'
 * wording is kept in `also`. A source that failed adds an error entry and no items.
 */
export function buildAttention(sources: readonly AttentionSourceResult[]): Attention {
  const errors: AttentionError[] = [];
  const merged = new Map<string, AttentionItem>();
  for (const s of sources) {
    if (s.status === "error") {
      if (!errors.some((e) => e.source === s.source)) errors.push({ source: s.source, label: SOURCE_LABEL[s.source] });
      continue;
    }
    for (const c of s.candidates) {
      const have = merged.get(c.key);
      if (!have) { merged.set(c.key, { ...c, at: c.at ?? null, also: [], sources: [c.source] }); continue; }
      const lead = c.tier < have.tier ? c : have;
      const also = [...new Set([...have.also, lead === c ? have.what : c.what])].filter((w) => w !== lead.what);
      merged.set(c.key, { ...lead, also, sources: [...new Set([...have.sources, c.source])], tier: Math.min(have.tier, c.tier) as AttentionTier, at: oldest(have.at, c.at ?? null) });
    }
  }
  const items = [...merged.values()].sort((a, b) => a.tier - b.tier || compareAt(a.at, b.at) || a.key.localeCompare(b.key));
  return { items, errors, count: items.length, headline: attentionHeadline(items.length, errors) };
}

const oldest = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a <= b ? a : b);
const compareAt = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b));

const tierOf = (due: string | null | undefined, today: string): AttentionTier => (due && due < today ? 0 : due === today ? 1 : 2);

// ---- Adapters: what each source loaded -> candidates (pure) ---------------------------------------------------------------------------------------

export const ok = (source: AttentionSource, candidates: readonly AttentionCandidate[]): AttentionSourceResult => ({ source, status: "ok", candidates });
export const failed = (source: AttentionSource): AttentionSourceResult => ({ source, status: "error" });

/** Approval steps waiting on the person. A leave request that starts today or has started is due now: it ranks as due or overdue, whatever its age. */
export function approvalCandidates(items: readonly PendingApprovalItem[], today: string, now: Date, formatDate: (d: string) => string): AttentionCandidate[] {
  return items.map((a) => {
    const tier = tierOf(a.dueDate, today);
    const starts = a.dueDate ? (a.dueDate === today ? "starts today" : `${a.dueDate < today ? "started" : "starts"} ${formatDate(a.dueDate)}`) : null;
    const when = [waitingAgeText(a.createdAt, now), starts].filter(Boolean).join(" · ");
    return { key: `approval:${a.entityType}:${a.entityId}`, source: "approvals", icon: ClipboardCheck, title: a.title, what: "Waiting for your decision", ...(when ? { when } : {}), tier, at: a.dueDate && tier < 2 ? a.dueDate : a.createdAt, href: "/approvals" };
  });
}

/** The few task fields the list needs. */
export interface AttentionTask { id: string; title: string; status: string; due_date: string | null; updatedAt: string; projectReference: string; projectName: string }

/**
 * The person's own tasks that are overdue or due today (a task they sent for review waits on someone else and is not theirs to do), and the tasks waiting for their
 * review. A task that is both is one item (same key): the review wording lands in `also` or leads, whichever is more urgent.
 */
export function taskCandidates(tasks: { today: string; open: readonly AttentionTask[]; reviews: readonly AttentionTask[] }, formatDate: (d: string) => string): AttentionCandidate[] {
  const base = (t: AttentionTask) => ({ key: `task:${t.id}`, source: "project-tasks" as const, icon: FolderKanban, title: t.title, context: `${t.projectReference} · ${t.projectName}`, href: `/projects/work?task=${t.id}` });
  const dueWhen = (t: AttentionTask) => (t.due_date && t.due_date < tasks.today ? `Overdue since ${formatDate(t.due_date)}` : t.due_date === tasks.today ? "Due today" : t.due_date ? `Due ${formatDate(t.due_date)}` : undefined);
  const out: AttentionCandidate[] = [];
  for (const t of tasks.open) {
    if (t.status === "ready_for_review") continue;
    const tier = tierOf(t.due_date, tasks.today);
    if (tier === 2) continue;
    out.push({ ...base(t), what: tier === 0 ? "Task overdue" : "Task due today", when: dueWhen(t)!, tier, at: t.due_date });
  }
  for (const t of tasks.reviews) {
    const tier = tierOf(t.due_date, tasks.today);
    const when = dueWhen(t);
    out.push({ ...base(t), href: `/projects/work?show=review&task=${t.id}`, what: "Task waiting for your review", ...(when ? { when } : {}), tier, at: t.due_date ?? t.updatedAt });
  }
  return out;
}

/** Project handovers and scope proposals waiting on the person. The handover shares its key with the Sales enquiry it came from (`opp:<id>`). */
export function projectDecisionCandidates(d: Pick<ProjectsAttention, "handoverList" | "scopeList">, now: Date): AttentionCandidate[] {
  return [
    ...d.handoverList.map((h): AttentionCandidate => ({
      key: `opp:${h.opportunityId}`, source: "project-decisions", icon: FolderKanban, title: h.title, context: h.reference,
      what: h.status === "pm_assigned" ? "Project handover waiting for you to accept" : "Project handover waiting for a project manager to be assigned",
      ...(waitingAgeText(h.at, now) ? { when: waitingAgeText(h.at, now)! } : {}), tier: 2, at: h.at, href: handoverHref(h.id),
    })),
    ...d.scopeList.map((r): AttentionCandidate => ({
      key: `scope:${r.id}`, source: "project-decisions", icon: FolderKanban, title: r.title, context: `${r.projectReference} · ${r.projectName}`, what: "Scope change waiting for your decision",
      ...(waitingAgeText(r.at, now) ? { when: waitingAgeText(r.at, now)! } : {}), tier: 2, at: r.at, href: `/projects/scope-decisions/${r.id}`,
    })),
  ];
}

/** Sales follow-ups that are overdue or due today and enquiries without a first response. One item per follow-up; an enquiry shares its key with its handover rows. */
export function salesCandidates(data: Pick<SalesToday, "attention">, formatDate: (d: string) => string): AttentionCandidate[] {
  const out: AttentionCandidate[] = [];
  for (const a of data.attention) {
    if (a.kind === "overdue" || a.kind === "due_today") {
      out.push({
        key: a.followUpId ? `followup:${a.followUpId}` : `followup:${a.opportunityId}:${a.at ?? ""}:${a.detail}`, source: "sales", icon: a.kind === "overdue" ? AlarmClock : CalendarClock, title: a.title, context: a.reference,
        what: `${a.kind === "overdue" ? "Follow-up overdue" : "Follow-up due today"}: ${a.detail}`, when: a.kind === "overdue" ? `Overdue since ${a.at ? formatDate(a.at) : "earlier"}` : "Due today",
        tier: a.kind === "overdue" ? 0 : 1, at: a.at, href: a.kind === "overdue" ? "/sales/follow-ups" : "/sales/follow-ups?view=today",
      });
    } else if (a.kind === "no_first_response") {
      out.push({ key: `opp:${a.opportunityId}`, source: "sales", icon: Inbox, title: a.title, context: a.reference, what: "Enquiry awaiting a first response", tier: 2, at: null, href: `/sales/opportunities/${a.opportunityId}` });
    }
  }
  return out;
}

/** Won enquiries without a handover and handover questions from the Project Manager. ("Handover accepted" is news, not an action: see `handoverNotice`.) */
export function handoverCandidates(check: Extract<HandoverCheck, { status: "ok" }>, now: Date): AttentionCandidate[] {
  return check.rows.filter((r) => r.kind !== "handover_accepted").map((r) => ({
    key: `opp:${r.opportunityId}`, source: "sales-handover", icon: FileCheck2, title: r.title, context: r.reference, what: HANDOVER_KIND_LABEL[r.kind],
    ...(waitingAgeText(r.at, now) ? { when: waitingAgeText(r.at, now)! } : {}), tier: 2, at: r.at, href: `/sales/opportunities/${r.opportunityId}/handover`,
  }));
}

/** Commercial approval requests waiting for a Sales founder, one per request. */
export function commercialApprovalCandidates(a: Extract<ApprovalsWaiting, { status: "ok" }>, now: Date): AttentionCandidate[] {
  return a.requests.map((r) => ({
    key: `crm-approval:${r.id}`, source: "sales-approvals", icon: BadgeCheck, title: r.title ?? "Commercial approval request", ...(r.reference ? { context: r.reference } : {}), what: "Commercial approval waiting for your decision",
    ...(waitingAgeText(r.requestedAt, now) ? { when: waitingAgeText(r.requestedAt, now)! } : {}), tier: 2, at: r.requestedAt, href: `/sales/opportunities/${r.opportunityId}?tab=commercial`,
  }));
}

/** Project budgets, final expenses and settlements the person decides now, and budgets of their projects sent back to them. Same record, same key (`budget:<id>`). */
export function budgetCandidates(day: Pick<BudgetDay, "waitingForMe" | "returned">, now: Date): AttentionCandidate[] {
  const one = (i: BudgetDay["waitingForMe"]["items"][number]): AttentionCandidate => ({
    key: i.key, source: "budgets", icon: ReceiptText, title: i.title, what: i.what, ...(i.context ? { context: i.context } : {}),
    ...(waitingAgeText(i.at, now) ? { when: waitingAgeText(i.at, now)! } : {}), tier: 2, at: i.at, href: i.href,
  });
  return [...day.waitingForMe.items.map(one), ...day.returned.items.map(one)];
}

/** Dispatch notes and return checklists waiting for the person's acknowledgement, one per note. */
export function noteCandidates(load: Extract<WaitingNotesLoad, { status: "ok" }>, now: Date): AttentionCandidate[] {
  return load.notes.map((n) => ({
    key: `note:${n.noteId}`, source: "notes", icon: ClipboardList, title: n.noteNo, context: `${n.projectRef} · ${n.projectName}`,
    what: n.kind === "return" ? "Returned equipment, please confirm" : "Dispatch note waiting for you", ...(waitingAgeText(n.waitingSince, now) ? { when: waitingAgeText(n.waitingSince, now)! } : {}),
    tier: 2, at: n.waitingSince, href: projectNotesHref(n.projectId, n.noteId),
  }));
}

/** The HR alerts: one row per kind (a screen of records, handled together on Alerts), with how many records it stands for. Zero rows are left out. */
export function hrCandidates(c: { contracts: number; probation: number; docs: number; identity: number }): AttentionCandidate[] {
  const rows: [string, string, LucideIcon, number][] = [
    ["hr:contracts", "Contracts ending soon", CalendarClock, c.contracts],
    ["hr:probation", "Probation reviews due", ShieldCheck, c.probation],
    ["hr:docs", "Documents expiring or expired", FileClock, c.docs],
    ["hr:identity", "Identity documents expiring soon", IdCard, c.identity],
  ];
  return rows.filter(([, , , n]) => n > 0).map(([key, title, icon, n]) => ({ key, source: "hr", icon, title, what: "Review on the Alerts page", tier: 2, at: null, href: "/alerts", records: n }));
}
