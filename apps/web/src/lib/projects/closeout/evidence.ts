/**
 * The Project Closeout Report's evidence, as the database function `proj_closeout_evidence` returns it, and the ONE place that turns it into what may be sent to the AI
 * provider. Pure: no database, no provider, no React.
 *
 * Three responsibilities are kept apart (and stay apart for any future entry point):
 *   1. the evidence collector is the database function: it reads only allowlisted columns of the authorised project;
 *   2. `buildOutbound` here decides what of that snapshot leaves Enginious OS. It is an allowlist: it names every value it emits, so a field added to the snapshot later
 *      is NOT sent unless this file is changed. Free text a person wrote is optional content the Project Manager selects on the review screen;
 *   3. the report writer (the provider) receives only the text built here and returns a draft; `validateDraft` (report.ts) checks it against the same items.
 * Every emitted item has a reference (S1, S2, ...) and names its source record, so a claim in the report can be traced back.
 * The app's existing AI data policy (lib/jarvis/protected.ts) is applied to every line here, before the review screen: a line with protected material, or one marked as
 * not for external sharing, is withheld and shown to the Project Manager as withheld. The report is stricter than the general policy on one point: a line that mentions an
 * amount of money (a price, a cost, a rate, a margin) is withheld too, wherever it was written. The outbound gate applies the general policy again to the whole text.
 */
import { findProtectedContent, wholeTextRestricted } from "@/lib/jarvis/protected";

export interface EvidenceSnapshot {
  taken_at: string;
  project: { id: string; reference: string; name: string; kind: string; status: string; start_date: string | null; end_date: string | null; client: string | null; venue: string | null; install_start: string | null; event_start: string | null; event_end: string | null; project_manager: string };
  handover: null | { id: string; sales_reference: string; title: string; venue: string | null; install_start: string | null; event_start: string | null; event_end: string | null; accepted_at: string | null; accepted_by: string | null; technologies: { name: string | null; qty: number | string | null }[]; notes_text: string | null };
  scope: { original_text: string | null; original_exclusions_text: string | null; current_text: string | null; current_exclusions_text: string | null; changed: boolean; approved_changes: number };
  team: { user_id: string; name: string; role: string; team: string | null; heads: string[]; active: boolean; tasks_done: number; tasks_assigned: number; milestones_accepted: number; deliverables_owned: string[] }[];
  milestones: { id: string; title: string; status: string; due_date: string | null; required: boolean; accepted_at: string | null; accepted_by: string | null }[];
  tasks: { total: number; done: number; open: number; cancelled: number; deferred: number; blocked: number; not_finished: { id: string; title: string; status: string; assignee: string; due_date: string | null; blocked: boolean }[] };
  plan: { id: string; key: string; zone: string; title: string; owner: string | null; needed_by: string | null; released: boolean; lines: { id: string; key: string; section: string; description: string; qty: number | null; released: boolean; request_line_id: string | null; task: null | { status: string; completed_at: string | null; assignee: string } }[] }[];
  decisions: { id: string; kind: "scope_change" | "plan_change" | "correction"; title: string | null; status: string; proposed_by: string; proposed_at: string; decided_by: string | null; decided_at: string | null; reason: string | null; effect_on_dates?: string | null; fields?: string[] | null }[];
  feedback: { id: string; received_on: string; kind: string; status: string; resolved_at: string | null; resolved_by: string | null; responsible: string | null; due_date: string | null; request_text: string | null; response_text: string | null }[];
  completion: null | { id: string; completed_at: string; completed_by: string; evidence_type: string; confirmed_on: string | null; has_reference: boolean; has_file: boolean; resolutions: { kind: string | null; action: string | null; title: string | null; note: string | null }[]; note_text: string | null };
  reopened_earlier: boolean;
  equipment: null | { requests: { id: string; code: string; status: string; expected_return_at: string | null; lines: { id: string; item: string; qty: number; status: string; sent: number; returned: number }[] }[] };
  missing: string[];
}

export type EvidenceCategory = "project" | "scope" | "team" | "decisions" | "feedback" | "delivery" | "handover" | "equipment" | "open_items";
export const CATEGORY_LABELS: Record<EvidenceCategory, string> = {
  project: "Project, venue and dates", scope: "Agreed scope and approved changes", team: "Team, roles and what each person owned", decisions: "Decisions: who, when and the recorded reason",
  feedback: "Client feedback and our response", delivery: "Delivery: milestones, plan, tasks, testing and installation", handover: "Handover and sign-off", equipment: "Equipment sent, returned and still out",
  open_items: "Incomplete, deferred and cancelled items",
};

/**
 * One line of evidence. `optional` items are free text a person wrote (scope wording, exclusions, a decision's reason, a written effect on dates, the client's words, our
 * response, notes). EVERY optional item starts unticked: it is sent only when the Project Manager deliberately ticks it on the review screen. The structured facts
 * (who, when, status, counts, dates) are part of the evidence without a tick.
 */
export interface EvidenceItem {
  ref: string; category: EvidenceCategory; text: string;
  /** The record this line comes from (for the link back to the source). */
  source: { type: string; id: string | null; label: string };
  optional?: { key: string; label: string; defaultOn: boolean };
  /** Set when the data policy keeps this line inside Enginious OS. It is never sent, whatever is selected. */
  withheld?: "protected" | "restricted" | "money" | "contact";
  /** The facts a report must never lose (status, completion, sign-off, task counts, equipment still out, what could not be read): never cut for size. */
  pinned?: boolean;
}

export interface CloseoutSelection { include: string[] }

const d = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null);
const range = (a: string | null, b: string | null) => (a && b && a !== b ? `${d(a)} to ${d(b)}` : d(a) ?? d(b));
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const one = (s: string | null | undefined, max = 240) => clip(String(s ?? "").replace(/\s+/g, " ").trim(), max);
/**
 * Text that people wrote is made safe to sit inside one evidence line: no angle brackets (so it cannot close the data tag or open another), no line breaks (so it
 * cannot start a line of its own) and no "[S12]"-shaped reference (so it cannot pass for another evidence line).
 */
const safe = (v: string) => v.replace(/[<>]/g, "").replace(/\s*[\r\n]+\s*/g, " / ").replace(/\[\s*(S\d+)\s*\]/gi, "($1)");
/** A display name that is only a sign-in name (the fallback when no full name is set) is part of an email address: it is not sent. */
const person = (v: string | null | undefined, none = "a person who is not recorded") => (!v ? none : /^[a-z0-9._+-]+$/.test(v.trim()) ? "a team member (full name not set)" : v);
const SECTION_WORDS: Record<string, string> = { hardware: "Hardware", content: "Content", programming: "Programming", installation: "Installation", testing: "Testing" };
const EVIDENCE_TYPE_WORDS: Record<string, string> = { email_reference: "an email reference", signed_handover: "a signed handover", uploaded_confirmation: "an uploaded confirmation", internal_note: "an internal note only (no client document)" };

/** Per-list limits keep the payload bounded; what is left out is counted in a line of its own, never silently dropped. */
export const LIMITS = { team: 40, milestones: 40, plan: 60, lines: 120, decisions: 40, feedback: 30, notFinished: 40, openMilestones: 20, resolutions: 30, technologies: 30, owned: 8, equipmentLines: 80, optionalChars: 1500 } as const;

/**
 * Every evidence item of a snapshot, in a fixed order with fixed references. Deterministic: the same snapshot always gives the same items and the same references.
 * This is the allowlist: nothing of the snapshot reaches the review screen or the provider except through a line written here.
 */
export function evidenceItems(s: EvidenceSnapshot): EvidenceItem[] {
  const out: Omit<EvidenceItem, "ref">[] = [];
  const add = (category: EvidenceCategory, text: string, type: string, id: string | null, label: string, optional?: EvidenceItem["optional"] | "pinned") => {
    out.push({ category, text: safe(text), source: { type, id, label }, ...(optional === "pinned" ? { pinned: true } : optional ? { optional: { ...optional, label: safe(optional.label) } } : {}) });
  };
  const more = (category: EvidenceCategory, total: number, shown: number, what: string) => { if (total > shown) add(category, `${total - shown} more ${what} are recorded and are not listed here.`, "project", s.project.id, "Project", "pinned"); };
  const p = s.project;

  // ---- project
  add("project", `Project ${p.reference} "${one(p.name)}" (${p.kind === "client" ? "client project" : "internal project"}). Status: ${p.status.replace(/_/g, " ")}. Project Manager: ${person(p.project_manager)}.`, "project", p.id, "Project", "pinned");
  add("project", `Client: ${p.client ? one(p.client, 120) : "not recorded"}. Venue: ${p.venue ? one(p.venue, 160) : "not recorded"}.`, "project", p.id, "Project details");
  add("project", `Installation starts: ${d(p.install_start) ?? "not recorded"}. Event: ${range(p.event_start, p.event_end) ?? "not recorded"}. Project dates: ${range(p.start_date, p.end_date) ?? "not recorded"}.`, "project", p.id, "Project details");
  if (s.handover) {
    const h = s.handover;
    add("project", `The project came from Sales handover ${h.sales_reference} "${one(h.title)}", accepted ${d(h.accepted_at) ?? "on a date that is not recorded"} by ${person(h.accepted_by)}. Event edition: not recorded as a field; see the handover notes if selected.`, "handover", h.id, "Sales handover");
    if (h.technologies.length > 0) add("scope", `Technologies listed on the handover: ${h.technologies.slice(0, LIMITS.technologies).map((t) => `${one(t.name, 80)} x ${t.qty ?? "?"}`).join("; ")}${h.technologies.length > LIMITS.technologies ? `; and ${h.technologies.length - LIMITS.technologies} more` : ""}.`, "handover", h.id, "Sales handover");
    if (h.notes_text?.trim()) add("project", `Handover notes for the Project Manager (as written): ${clip(h.notes_text.trim(), LIMITS.optionalChars)}`, "handover", h.id, "Sales handover notes", { key: `handover-notes:${h.id}`, label: "Handover notes for the Project Manager", defaultOn: false });
  } else add("project", "No accepted Sales handover is recorded for this project.", "project", p.id, "Project");

  // ---- scope: the original agreement and the final scope stay distinct
  const sc = s.scope;
  add("scope", s.handover ? (sc.changed ? `The agreed scope now differs from the scope on the accepted handover. Approved scope changes: ${sc.approved_changes}.` : `The agreed scope is the same as on the accepted handover. Approved scope changes: ${sc.approved_changes}.`) : `Approved scope changes: ${sc.approved_changes}.`, "project", p.id, "Feedback & changes");
  if (sc.original_text?.trim()) add("scope", `ORIGINAL scope, as agreed at handover (as written): ${clip(sc.original_text.trim(), LIMITS.optionalChars)}`, "handover", s.handover?.id ?? null, "Sales handover scope", { key: "scope-original", label: "Original scope (as agreed at handover)", defaultOn: false });
  if (sc.original_exclusions_text?.trim()) add("scope", `ORIGINAL exclusions (as written): ${clip(sc.original_exclusions_text.trim(), LIMITS.optionalChars)}`, "handover", s.handover?.id ?? null, "Sales handover exclusions", { key: "scope-original-exclusions", label: "Original exclusions", defaultOn: false });
  if (sc.current_text?.trim() && (sc.changed || !sc.original_text?.trim())) add("scope", `FINAL agreed scope (as written): ${clip(sc.current_text.trim(), LIMITS.optionalChars)}`, "project", p.id, "Agreed scope", { key: "scope-current", label: "Final agreed scope", defaultOn: false });
  if (sc.current_exclusions_text?.trim() && (sc.changed || !sc.original_exclusions_text?.trim())) add("scope", `FINAL exclusions (as written): ${clip(sc.current_exclusions_text.trim(), LIMITS.optionalChars)}`, "project", p.id, "Agreed exclusions", { key: "scope-current-exclusions", label: "Final exclusions", defaultOn: false });
  if (!sc.original_text?.trim() && !sc.current_text?.trim()) add("scope", "No agreed scope text is recorded.", "project", p.id, "Project details");

  // ---- team: names, roles and recorded ownership only. No effort, dedication or performance is inferred.
  for (const m of s.team.slice(0, LIMITS.team)) {
    const owned = [
      m.tasks_assigned > 0 ? `${m.tasks_done} of ${m.tasks_assigned} assigned tasks done` : null,
      m.milestones_accepted > 0 ? `accepted ${m.milestones_accepted} milestone${m.milestones_accepted === 1 ? "" : "s"}` : null,
      m.deliverables_owned.length > 0 ? `accountable owner of ${m.deliverables_owned.slice(0, LIMITS.owned).map((x) => one(x, 80)).join("; ")}${m.deliverables_owned.length > LIMITS.owned ? ` and ${m.deliverables_owned.length - LIMITS.owned} more` : ""}` : null,
      m.heads.length > 0 ? `head of ${m.heads.map((x) => one(x, 60)).join(", ")}` : null,
    ].filter(Boolean);
    add("team", `${person(m.name)}: ${m.role}${m.team ? `, ${one(m.team, 60)}` : ""}${m.active ? "" : " (no longer on the project)"}. Recorded ownership: ${owned.length > 0 ? owned.join("; ") : "none recorded"}.`, "member", m.user_id, "People & access");
  }
  more("team", s.team.length, LIMITS.team, "team members");

  // ---- decisions
  const KIND = { scope_change: "Scope change", plan_change: "Change to the released delivery plan", correction: "Correction" } as const;
  for (const x of s.decisions.slice(0, LIMITS.decisions)) {
    const base = `${KIND[x.kind]} "${one(x.title ?? "untitled", 160)}": ${x.status} by ${person(x.decided_by)} on ${d(x.decided_at) ?? "a date that is not recorded"}; raised by ${person(x.proposed_by)} on ${d(x.proposed_at)}.${x.fields?.length ? ` Fields changed: ${x.fields.join(", ").replace(/_/g, " ")}.` : ""}`;
    add("decisions", `${base} Recorded reason: ${x.reason?.trim() ? "one is recorded" : "none recorded"}.`, x.kind, x.id, KIND[x.kind]);
    if (x.reason?.trim()) add("decisions", `Reason recorded for "${one(x.title ?? "untitled", 100)}" (as written): ${clip(x.reason.trim(), 600)}`, x.kind, x.id, `${KIND[x.kind]} reason`, { key: `decision-reason:${x.id}`, label: `Reason: ${one(x.title ?? KIND[x.kind], 80)}`, defaultOn: false });
    if (x.effect_on_dates?.trim()) add("decisions", `Stated effect on dates of "${one(x.title ?? "untitled", 100)}" (as written): ${clip(x.effect_on_dates.trim(), 400)}`, x.kind, x.id, "Scope change effect on dates", { key: `decision-dates:${x.id}`, label: `Effect on dates: ${one(x.title ?? "", 80)}`, defaultOn: false });
  }
  more("decisions", s.decisions.length, LIMITS.decisions, "decisions");
  if (s.decisions.length === 0) add("decisions", "No decided scope change, plan change or correction is recorded.", "project", p.id, "Feedback & changes");

  // ---- client feedback: facts always; the client's words and our response only when selected
  const FK: Record<string, string> = { in_scope_correction: "a correction within scope", proposed_change: "a proposed change" };
  for (const [i, f] of s.feedback.slice(0, LIMITS.feedback).entries()) {
    const open = f.status === "open" || f.status === "in_progress";
    add(open ? "open_items" : "feedback", `Client feedback ${i + 1}, received ${d(f.received_on)}, recorded as ${FK[f.kind] ?? f.kind}: ${f.status.replace(/_/g, " ")}${f.resolved_at ? ` on ${d(f.resolved_at)} by ${person(f.resolved_by)}` : ""}.${open ? ` Open follow-up${f.responsible ? ` with ${person(f.responsible)}` : ""}${f.due_date ? `, due ${d(f.due_date)}` : ""}.` : ""}`, "feedback", f.id, "Client feedback");
    if (f.request_text?.trim()) add("feedback", `Client feedback ${i + 1}, the client's request (exact recorded text): "${clip(f.request_text.trim(), LIMITS.optionalChars)}"`, "feedback", f.id, "Client feedback text", { key: `feedback-request:${f.id}`, label: `Feedback ${i + 1}: the client's words`, defaultOn: false });
    if (f.response_text?.trim()) add("feedback", `Client feedback ${i + 1}, our recorded response (exact recorded text): "${clip(f.response_text.trim(), LIMITS.optionalChars)}"`, "feedback", f.id, "Client feedback response", { key: `feedback-response:${f.id}`, label: `Feedback ${i + 1}: our response`, defaultOn: false });
  }
  more("feedback", s.feedback.length, LIMITS.feedback, "client feedback records");
  if (s.feedback.length === 0) add("feedback", "No client feedback is recorded.", "project", p.id, "Feedback & changes");

  // ---- delivery: milestones, plan with its linked work, task counts
  for (const m of s.milestones.slice(0, LIMITS.milestones)) add("delivery", `Milestone "${one(m.title, 160)}"${m.required ? "" : " (optional)"}: ${m.status.replace(/_/g, " ")}${m.accepted_at ? `, accepted ${d(m.accepted_at)} by ${person(m.accepted_by)}` : ""}${m.due_date ? `; due ${d(m.due_date)}` : "; no due date recorded"}.`, "milestone", m.id, "Milestone");
  more("delivery", s.milestones.length, LIMITS.milestones, "milestones");
  if (s.milestones.length === 0) add("delivery", "No milestone is recorded.", "project", p.id, "Work");
  const eqLine = new Map<string, { sent: number; returned: number; qty: number }>();
  for (const r of s.equipment?.requests ?? []) for (const l of r.lines) eqLine.set(l.id, { sent: n(l.sent), returned: n(l.returned), qty: n(l.qty) });
  let lineBudget: number = LIMITS.lines;
  const allLines = s.plan.slice(0, LIMITS.plan).reduce((a, it) => a + it.lines.length, 0);
  for (const it of s.plan.slice(0, LIMITS.plan)) {
    add("delivery", `Deliverable ${it.key} "${one(it.title, 160)}"${it.zone ? ` in ${one(it.zone, 60)}` : ""}: accountable owner ${person(it.owner, "not recorded")}; needed by ${d(it.needed_by) ?? "not recorded"}; ${it.released ? "released to the teams" : "not released"}.`, "deliverable", it.id, "Delivery plan");
    for (const l of it.lines) {
      if (lineBudget-- <= 0) break;
      const state = !l.released ? "not released"
        : l.section === "hardware" ? (() => { const e = l.request_line_id ? eqLine.get(l.request_line_id) : undefined; return !e ? "equipment line state not known" : e.sent > 0 ? `sent ${fmt(e.sent)} of ${fmt(e.qty)}, returned ${fmt(e.returned)}` : "requested, not sent"; })()
        : l.task ? `task ${l.task.status.replace(/_/g, " ")}${l.task.completed_at ? ` on ${d(l.task.completed_at)}` : ""}, with ${person(l.task.assignee)}` : "task state not known";
      add("delivery", `${it.key} / ${l.key} ${SECTION_WORDS[l.section] ?? l.section}: "${one(l.description, 160)}"${l.qty !== null ? ` x ${fmt(n(l.qty))}` : ""}: ${state}.`, "plan_line", l.id, "Delivery plan line");
    }
  }
  more("delivery", allLines, LIMITS.lines, "delivery plan lines");
  more("delivery", s.plan.length, LIMITS.plan, "deliverables");
  if (s.plan.length === 0) add("delivery", "No delivery plan is recorded for this project.", "project", p.id, "Delivery plan");
  const t = s.tasks;
  add("delivery", `Tasks: ${t.total} in all; ${t.done} done, ${t.open} open (${t.blocked} blocked), ${t.deferred} deferred, ${t.cancelled} cancelled.`, "project", p.id, "Work", "pinned");

  // ---- open items: what is incomplete, deferred or cancelled
  for (const x of t.not_finished.slice(0, LIMITS.notFinished)) add("open_items", `Task "${one(x.title, 160)}": ${x.status.replace(/_/g, " ")}${x.blocked ? " and blocked" : ""}, with ${person(x.assignee)}${x.due_date ? `, due ${d(x.due_date)}` : ""}.`, "task", x.id, "Task");
  const openMs = s.milestones.filter((x) => x.status !== "accepted");
  more("open_items", openMs.length, LIMITS.openMilestones, "milestones that are not accepted");
  more("open_items", s.completion?.resolutions.length ?? 0, LIMITS.resolutions, "decisions on open items at completion");
  for (const m of openMs.slice(0, LIMITS.openMilestones)) add("open_items", `Milestone "${one(m.title, 160)}" is ${m.status.replace(/_/g, " ")} (not accepted).`, "milestone", m.id, "Milestone");
  for (const r of (s.completion?.resolutions ?? []).slice(0, LIMITS.resolutions)) add("open_items", `At completion, ${r.kind ?? "an item"} "${one(r.title ?? "untitled", 140)}" was decided as: ${r.action ?? "not recorded"}.`, "completion", s.completion!.id, "Completion record");

  // ---- handover and sign-off. Delivery complete and equipment returned are separate facts.
  if (s.completion) {
    const c = s.completion;
    add("handover", `The project was recorded as completed on ${d(c.completed_at)} by ${person(c.completed_by)}.`, "completion", c.id, "Completion record", "pinned");
    add("handover", p.kind === "client"
      ? `Client sign-off: recorded as ${EVIDENCE_TYPE_WORDS[c.evidence_type] ?? c.evidence_type.replace(/_/g, " ")}${c.confirmed_on ? `, confirmed ${d(c.confirmed_on)}` : ", confirmation date not recorded"}; ${c.has_file ? "a confirmation file is attached to the record" : c.has_reference ? "a reference is recorded" : "no file or reference is recorded"}.`
      : "Internal project: no client sign-off applies.", "completion", c.id, "Completion record", "pinned");
    if (c.note_text?.trim()) add("handover", `Completion note by ${person(c.completed_by)} (as written): ${clip(c.note_text.trim(), LIMITS.optionalChars)}`, "completion", c.id, "Completion note", { key: `completion-note:${c.id}`, label: "Completion note", defaultOn: false });
  } else {
    add("handover", "Completion: NOT RECORDED. The project has no completion record.", "project", p.id, "Complete project", "pinned");
    add("handover", p.kind === "client" ? "Client sign-off: NOT RECORDED. No client confirmation of completion is recorded." : "Internal project: no client sign-off applies.", "project", p.id, "Complete project", "pinned");
  }
  if (s.reopened_earlier) add("handover", "The project was completed earlier and then reopened; the earlier completion record is kept in History.", "project", p.id, "History");

  // ---- equipment
  if (s.equipment) {
    let budget: number = LIMITS.equipmentLines; let out = 0; let lines = 0;
    for (const r of s.equipment.requests) {
      for (const l of r.lines) {
        const sent = n(l.sent), back = n(l.returned), still = Math.max(0, sent - back);
        out += still; lines += 1;
        if (budget-- > 0) add("equipment", `Equipment request ${r.code} (${r.status.replace(/_/g, " ")}): ${one(l.item, 120)}, asked ${fmt(n(l.qty))}, sent ${fmt(sent)}, returned ${fmt(back)}, still out ${fmt(still)}${still > 0 && r.expected_return_at ? `, due back ${d(r.expected_return_at)}` : ""}.`, "equipment_line", l.id, "Equipment request line");
      }
    }
    more("equipment", lines, LIMITS.equipmentLines, "equipment lines");
    add("equipment", s.equipment.requests.length === 0 ? "No equipment request is recorded for this project." : out > 0 ? `Equipment still out, all requests together: ${fmt(out)} unit${out === 1 ? "" : "s"}. Delivery being complete does not mean the equipment is back.` : "All equipment that was sent is recorded as returned.", "project", p.id, "Equipment", "pinned");
  }
  for (const m of s.missing) add("equipment", `NOT AVAILABLE: ${one(m, 200)}.`, "project", p.id, "Equipment", "pinned");

  return out.map((x, i) => ({ ...x, ref: `S${i + 1}`, ...withheldReason(x.text) }));
}

const CURRENCY = "(?:aed|usd|sar|eur|gbp|qar|omr|kwd|bhd|dhs?|dirhams?|riyals?|dollars?|euros?|pounds?(?!\\s+(?:of|per))|sterling)";
const NUMBER_WORD = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|lakh)";
const AMOUNT = `(?:\\d[\\d,.]*\\s?(?:k|m|mn|million|thousand)?|${NUMBER_WORD}(?:[\\s-]+(?:and\\s+)?${NUMBER_WORD})*)`;
const MONEY_RE = new RegExp(`\\b${CURRENCY}\\.?\\s?${AMOUNT}\\b|\\b${AMOUNT}\\s?${CURRENCY}\\b|[$€£]\\s?\\d`, "i");
/** A word that is about what something costs or earns. Deliberately without "rate", "value", "total" and "charge", which event technology uses for other things. */
const PRICE_WORD = /\b(?:pric(?:e|es|ed|ing)|costs?|costing|fees?|budgets?|margins?|mark-?ups?|discounts?|invoic(?:e|es|ed)|quot(?:ed|ation|ations)|payments?|paid|deposits?|profits?|revenues?|turnover|rental|vat|salar(?:y|ies)|wages?)\b/i;
const FIGURE_NEAR = new RegExp(`\\b(?:\\d[\\d,.]*\\s?%?|${NUMBER_WORD})\\b`, "i");
/**
 * Does a line mention an amount of money? Stricter than the general policy on what counts (a currency next to a figure or a number in words; or a price word within a
 * short distance of any figure), and narrower on what does not: "4K", "120 Hz", "refresh rate" and quantities are ordinary event-technology wording, not money.
 */
export function mentionsAmount(raw: string): boolean {
  const text = raw.normalize("NFKC").replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ").replace(/\b\d+(?:\.\d+)?\s?k\b(?=\s*(?:uhd|hdr|led|oled|lcd|display|screen|panel|projector|wall|content|video|render|resolution|media|camera|monitor|tv)\b)/gi, " ").replace(/\b[48]k\b/gi, " ");
  if (MONEY_RE.test(text)) return true;
  return text.split(/(?<=[.!?;])\s+/).some((sentence) => {
    const m = PRICE_WORD.exec(sentence);
    if (!m) return false;
    const around = sentence.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(m[0], " ");
    return FIGURE_NEAR.test(around);
  });
}
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const URL = /\b(?:https?:\/\/|www\.)\S+/i;
/** A phone-like run: an international prefix, or eight or more digits with only spaces, dots, dashes or brackets between them. Calendar dates are not phone numbers. */
const PHONE = /(?:\+|\b00)\d[\d\s().-]{6,}\d|(?<![\w-])\d(?:[\s().-]?\d){7,}(?![\w-])/;
export function mentionsContact(raw: string): boolean {
  const text = raw.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  return EMAIL.test(text) || URL.test(text) || PHONE.test(text);
}
function withheldReason(text: string): { withheld?: EvidenceItem["withheld"] } {
  if (wholeTextRestricted(text)) return { withheld: "restricted" };
  if (findProtectedContent(text).length > 0) return { withheld: "protected" };
  if (mentionsContact(text)) return { withheld: "contact" };
  if (mentionsAmount(text)) return { withheld: "money" };
  return {};
}
export const WITHHELD_WORDS: Record<NonNullable<EvidenceItem["withheld"]>, string> = {
  restricted: "marked as not for external sharing", protected: "contains details that stay inside Enginious OS", money: "mentions an amount of money",
  contact: "contains an email address, a phone number or a web address",
};

/** The optional items a selection includes. With no selection given, the defaults apply. */
export function selectedItems(items: readonly EvidenceItem[], selection: CloseoutSelection | null): EvidenceItem[] {
  const on = selection ? new Set(selection.include) : null;
  return items.filter((x) => !x.withheld && (!x.optional || (on ? on.has(x.optional.key) : x.optional.defaultOn)));
}

export const OUTBOUND_BUDGET = 20_000;

/**
 * Exactly what is sent to the provider as app-held text: the selected items, one per line, each with its reference. Bounded: if it would exceed the budget, optional text
 * goes first, then the longest lists are cut from the end, and what was left out is reported (`dropped`), so the review screen and the draft can say so.
 */
export function buildOutbound(items: readonly EvidenceItem[], selection: CloseoutSelection | null): { text: string; sent: EvidenceItem[]; dropped: EvidenceItem[] } {
  let sent = selectedItems(items, selection);
  const dropped: EvidenceItem[] = [];
  const line = (x: EvidenceItem) => `[${x.ref}] (${CATEGORY_LABELS[x.category]}) ${x.text}`;
  const size = (xs: readonly EvidenceItem[]) => xs.reduce((a, x) => a + line(x).length + 1, 0);
  for (;;) {
    if (size(sent) <= OUTBOUND_BUDGET) break;
    // Cut order: optional free text, then delivery plan lines, then the other long lists, then anything else, each from the end. Pinned lines (status, completion,
    // sign-off, task counts, equipment still out, what could not be read, and the "N more are not listed" lines) are never cut.
    const last = (test: (x: EvidenceItem) => boolean) => { for (let i = sent.length - 1; i >= 0; i--) if (!sent[i]!.pinned && test(sent[i]!)) return i; return -1; };
    const idx = [last((x) => !!x.optional), last((x) => x.source.type === "plan_line"), last((x) => ["deliverable", "task", "milestone", "member", "equipment_line"].includes(x.source.type)), last(() => true)].find((i) => i >= 0);
    if (idx === undefined) break;
    dropped.unshift(sent[idx]!);
    sent = sent.filter((_, i) => i !== idx);
  }
  return { text: sent.map(line).join("\n"), sent, dropped };
}

/** A stable fingerprint of a payload (not a secret): the same reviewed content gives the same value, so a retry can find the draft that already holds its result. */
export function payloadHash(text: string): string {
  let h1 = 0xdeadbeef ^ text.length, h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i++) { const ch = text.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `p${text.length.toString(36)}-${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

/** What the review screen shows before anything is sent: the categories with their counts, the team names, and every optional text with whether it is selected. */
export function reviewSummary(items: readonly EvidenceItem[], selection: CloseoutSelection | null, s: Pick<EvidenceSnapshot, "team" | "missing">) {
  const { sent, dropped, text } = buildOutbound(items, selection);
  const categories = (Object.keys(CATEGORY_LABELS) as EvidenceCategory[]).map((c) => ({ category: c, label: CATEGORY_LABELS[c], lines: sent.filter((x) => x.category === c).length })).filter((c) => c.lines > 0);
  const on = new Set(sent.filter((x) => x.optional).map((x) => x.optional!.key));
  return {
    categories, teamNames: s.team.slice(0, LIMITS.team).map((m) => m.name),
    optional: items.filter((x) => x.optional && !x.withheld).map((x) => ({ key: x.optional!.key, label: x.optional!.label, text: x.text, selected: on.has(x.optional!.key), ref: x.ref })),
    withheld: items.filter((x) => x.withheld).map((x) => ({ ref: x.ref, label: x.optional?.label ?? x.source.label, why: WITHHELD_WORDS[x.withheld!] })),
    missing: s.missing, dropped: dropped.map((x) => x.ref), chars: text.length, lines: sent.length, text, hash: payloadHash(text),
  };
}
