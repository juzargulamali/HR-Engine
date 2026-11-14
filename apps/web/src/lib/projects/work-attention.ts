/**
 * What needs doing on one project, for the person looking at it. Pure: every line comes from a recorded fact (a task's blocker, a review request, a due date, a milestone's
 * date, an equipment request's status). Nothing is estimated; where a detail was never recorded the line says so ("No one named", "No due date").
 * Two lists: work that needs THIS viewer, and work that is waiting on someone else. Permissions are not decided here: the links open the existing screens, which check.
 */
import { READINESS_LOAD_ERROR, readinessSummary, REVIEW_FIELD_LABEL, reviewChangeText, type EquipmentReadinessResult, type EquipmentReview } from "./equipment-readiness-model";

export interface AttentionTask {
  id: string; title: string; status: string; due_date: string | null; assignee_id: string; blocked_at: string | null; blocked_reason: string | null;
  unblock_owner_id: string | null; unblock_action: string | null;
}
export interface AttentionMilestone { id: string; title: string; due_date: string | null }
export type AttentionKind = "blocker" | "review" | "output" | "output_changes" | "overdue" | "due_today" | "in_review" | "milestone" | "equipment";
export interface AttentionItem {
  key: string; kind: AttentionKind;
  /** The word shown beside the colour, so the colour is never the only signal. */
  label: string;
  title: string; href: string;
  /** Who owns the next step, in words ("You", a name, "Warehouse", or that nobody is named). */
  owner: string;
  /** YYYY-MM-DD, or null when no date is recorded. */
  due: string | null;
  detail: string | null;
  tone: "red" | "amber" | "blue" | "quiet";
  /** True when a control on the Work page itself can resolve it (the failed equipment import). */
  recovery?: "import";
  /** An output line: the task it belongs to, the output it expects and the next step in words (shown beside the owner and due date). */
  taskId?: string;
  expected?: string | null;
  next?: string | null;
}

export type EquipmentState =
  | { status: "ok"; drafts: { id: string; code: string }[]; waiting: { id: string; code: string }[]; importFailed: { at: string; detail: string | null } | null; requests: number }
  | { status: "unavailable" }
  | { status: "error" };

export interface AttentionInput {
  tasks: readonly AttentionTask[];
  /** Ids of the tasks this viewer may review now (the page's review queue). */
  reviewIds: readonly string[];
  lateMilestones: readonly AttentionMilestone[];
  equipment: EquipmentState;
  /** Open "Review equipment booking" entries (a committed date changed while a request was with the warehouse). Absent or empty = none known. */
  equipmentReviews?: readonly EquipmentReview[];
  userId: string;
  /** Project Manager, temporary leader or founder of this project. */
  manager: boolean;
  pmName: string;
  today: string;
  nameOf: (userId: string | null | undefined) => string;
  taskHref: (taskId: string) => string;
  milestonesHref: string;
  equipmentHref: (requestId?: string) => string;
  /** Output lines from the deliverables register (see work-queues.ts). Their tasks no longer get a generic "Review" or "In review" line, so one task is never listed twice. */
  outputs?: { needsYou: readonly AttentionItem[]; waiting: readonly AttentionItem[]; handledTaskIds: ReadonlySet<string> };
}

const OPEN = ["todo", "in_progress", "ready_for_review"];
const byDue = (a: AttentionItem, b: AttentionItem) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.title.localeCompare(b.title);

export function workAttention(i: AttentionInput): { needsYou: AttentionItem[]; waiting: AttentionItem[] } {
  const needsYou: AttentionItem[] = [];
  const waiting: AttentionItem[] = [];
  const open = i.tasks.filter((t) => OPEN.includes(t.status));

  // Blockers: the named person clears it; with nobody named it falls to whoever manages the project.
  for (const t of open.filter((x) => x.blocked_at)) {
    const mine = t.unblock_owner_id ? t.unblock_owner_id === i.userId : i.manager;
    const owner = t.unblock_owner_id ? (mine ? "You" : i.nameOf(t.unblock_owner_id)) : mine ? "You (no one is named, so it falls to the Project Manager)" : `No one named; ${i.pmName} manages the project`;
    const detail = [t.blocked_reason ? `Reason: ${t.blocked_reason}` : "No reason recorded", t.unblock_action ? `To clear it: ${t.unblock_action}` : null].filter(Boolean).join(" · ");
    (mine ? needsYou : waiting).push({ key: `b-${t.id}`, kind: "blocker", label: "Blocked", title: t.title, href: i.taskHref(t.id), owner, due: t.due_date, detail, tone: "red" });
  }
  // Reviews the viewer may decide.
  const handled = i.outputs?.handledTaskIds ?? new Set<string>();
  for (const t of open.filter((x) => i.reviewIds.includes(x.id) && !handled.has(x.id))) {
    needsYou.push({ key: `r-${t.id}`, kind: "review", label: "Review", title: t.title, href: i.taskHref(t.id), owner: "You", due: t.due_date, detail: `Done by ${i.nameOf(t.assignee_id)}. Accept it or send it back.`, tone: "blue" });
  }
  // The viewer's own tasks: overdue or due today (a blocked one is already listed above).
  for (const t of open.filter((x) => x.assignee_id === i.userId && !x.blocked_at && x.status !== "ready_for_review" && x.due_date && x.due_date <= i.today)) {
    const late = (t.due_date as string) < i.today;
    needsYou.push({ key: `d-${t.id}`, kind: late ? "overdue" : "due_today", label: late ? "Overdue" : "Due today", title: t.title, href: i.taskHref(t.id), owner: "You", due: t.due_date, detail: null, tone: "amber" });
  }
  // The viewer's work that someone else must review.
  for (const t of open.filter((x) => x.assignee_id === i.userId && x.status === "ready_for_review" && !x.blocked_at && !handled.has(x.id))) {
    waiting.push({ key: `w-${t.id}`, kind: "in_review", label: "In review", title: t.title, href: i.taskHref(t.id), owner: "A reviewer (the team lead or the Project Manager)", due: t.due_date, detail: "You sent it for review.", tone: "quiet" });
  }
  needsYou.push(...(i.outputs?.needsYou ?? []));
  waiting.push(...(i.outputs?.waiting ?? []));
  // Overdue milestones belong to whoever manages the project.
  for (const m of i.lateMilestones) {
    (i.manager ? needsYou : waiting).push({ key: `m-${m.id}`, kind: "milestone", label: "Milestone overdue", title: m.title, href: i.milestonesHref, owner: i.manager ? "You" : i.pmName, due: m.due_date, detail: null, tone: "amber" });
  }
  // Equipment: only what the system can confirm. Submitting stays an explicit action on the Equipment page.
  if (i.equipment.status === "ok") {
    const e = i.equipment;
    if (e.importFailed && i.manager) {
      needsYou.push({ key: "e-import", kind: "equipment", label: "Import failed — review", title: "The handover equipment was not imported", href: i.equipmentHref(), owner: "You", due: null, detail: e.importFailed.detail ?? "No reason was recorded.", tone: "red", recovery: "import" });
    }
    for (const d of e.drafts) {
      (i.manager ? needsYou : waiting).push({ key: `e-d-${d.id}`, kind: "equipment", label: "Equipment draft needs submission", title: `Request ${d.code}`, href: i.equipmentHref(d.id), owner: i.manager ? "You" : i.pmName, due: null, detail: "The warehouse does not see a draft. Review the list and submit it on the Equipment page.", tone: "amber" });
    }
    for (const w of e.waiting) {
      waiting.push({ key: `e-w-${w.id}`, kind: "equipment", label: "Waiting for Warehouse", title: `Request ${w.code}`, href: i.equipmentHref(w.id), owner: "Warehouse", due: null, detail: "Submitted. The warehouse has not started preparing it.", tone: "quiet" });
    }
  }
  // A committed date changed while a request was with the warehouse: one line per request, whatever the equipment read above said. The booking itself is not changed
  // here or anywhere automatically; the line opens the Equipment tab, where the review lists each date and links to the request.
  const byRequest = new Map<string, EquipmentReview[]>();
  for (const v of i.equipmentReviews ?? []) byRequest.set(v.requestId, [...(byRequest.get(v.requestId) ?? []), v]);
  for (const [requestId, vs] of byRequest) {
    (i.manager ? needsYou : waiting).push({
      key: `e-v-${requestId}`, kind: "equipment", label: "Review equipment booking", title: `Request ${vs[0]!.requestCode}`, href: `${i.equipmentHref()}#equipment-review`, owner: i.manager ? "You" : i.pmName, due: null,
      detail: `${vs.map((v) => `${REVIEW_FIELD_LABEL[v.field]}: ${reviewChangeText(v)}`).join(" · ")}. The booking has not been changed.`, tone: "amber",
    });
  }
  const order: AttentionKind[] = ["blocker", "review", "output", "output_changes", "overdue", "due_today", "milestone", "equipment", "in_review"];
  const rank = (a: AttentionItem) => order.indexOf(a.kind);
  // Equipment lines keep the order they were added in (a failed import before drafts before waiting); the rest go by due date.
  const sort = (xs: AttentionItem[]) => xs.sort((a, b) => rank(a) - rank(b) || (a.kind === "equipment" ? 0 : byDue(a, b)));
  return { needsYou: sort(needsYou), waiting: sort(waiting) };
}

/**
 * The equipment line of the delivery summary: one confirmed state in words, or that nothing could be confirmed. A decision the manager owes (a failed import, a draft) comes
 * first; then the readiness the database states for the requests that are with the warehouse (reserved, short, dispatched, still out); a failed readiness read says it could
 * not be loaded and is never shown as "nothing waiting".
 */
export function equipmentSummary(e: EquipmentState, readiness?: EquipmentReadinessResult): { text: string; tone: "red" | "amber" | "quiet"; detail?: string | null } {
  if (e.status === "error") return { text: "Could not load the equipment state", tone: "red" };
  if (e.status === "ok" && e.importFailed) return { text: "Import failed — review", tone: "red" };
  if (e.status === "ok" && e.drafts.length > 0) return { text: e.drafts.length === 1 ? "Equipment draft needs submission" : `${e.drafts.length} equipment drafts need submission`, tone: "amber" };
  if (readiness?.state === "error") return { text: READINESS_LOAD_ERROR, tone: "red" };
  if (readiness?.state === "ok") {
    const r = readinessSummary(readiness.readiness);
    if (r) return r;
  }
  if (e.status === "unavailable") return { text: "Not available to you here", tone: "quiet" };
  if (e.waiting.length > 0) return { text: "Waiting for Warehouse", tone: "quiet" };
  return { text: e.requests === 0 ? "No equipment request yet" : "No decision waiting", tone: "quiet" };
}
