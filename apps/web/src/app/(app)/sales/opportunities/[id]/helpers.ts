import { AVAILABILITY_LABELS, crmStageLabel, isCrmActive, type ApprovalPolicy, type AvailabilityDisplay } from "@enginious-hr/domain";
import type { CrmActivityRow, CrmFileRow, CrmFollowUpRow, CrmOpportunityEventRow, CrmOpportunityRow, CrmProposalRow, CrmCompanySettingsRow } from "@/types/crm";

/**
 * Pure helpers for the opportunity pages (no React, no server-only imports) so they can be unit tested.
 * Everything here shapes data that the database has already validated; none of it is a rule.
 */

// ---------------------------------------------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------------------------------------------

export type TimelineEntry =
  | { kind: "activity"; id: string; at: string; activity: CrmActivityRow }
  | { kind: "event"; id: string; at: string; event: CrmOpportunityEventRow };

/** Activities (what people did) and events (what changed on the record) in one list, newest first. */
export function buildTimeline(activities: readonly CrmActivityRow[], events: readonly CrmOpportunityEventRow[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...activities.map((a): TimelineEntry => ({ kind: "activity", id: `a-${a.id}`, at: a.occurred_at, activity: a })),
    ...events.map((e): TimelineEntry => ({ kind: "event", id: `e-${e.id}`, at: e.created_at, event: e })),
  ];
  return entries.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
}

const DETAIL_FIELD_LABELS: Record<string, string> = {
  title: "title", brief: "brief", agency_org_id: "agency", client_org_id: "end client", source: "source", budget_note: "budget note",
  payment_terms: "payment terms", event_start: "show start date", event_end: "show end date", install_start: "installation date", location: "location",
  technologies: "technologies and quantities", scope: "scope", exclusions: "exclusions", risks: "risks", waiting_on: "waiting on",
};

const AVAILABILITY_EVENT_WORDS: Record<string, string> = {
  awaiting: "check requested", confirmed: "confirmed available", unavailable: "recorded as not available", unverified: "not checked",
};

const APPROVAL_EVENT_WORDS: Record<string, string> = {
  requested: "approval requested", approved: "approved by a founder", changes_requested: "changes requested by a founder",
};

const EVIDENCE_WORDS: Record<string, string> = { purchase_order: "Purchase order", authorised_email: "Authorised email" };

/** One plain sentence for a change-log row. `personName` resolves user ids stored in owner_changed rows. */
export function describeEvent(e: Pick<CrmOpportunityEventRow, "kind" | "from_value" | "to_value" | "reason">, personName: (id: string | null | undefined) => string): string {
  const reason = e.reason ? ` Reason: ${e.reason}.` : "";
  switch (e.kind) {
    case "created": return "Enquiry created.";
    case "stage_changed": return `Stage changed from ${crmStageLabel(e.from_value ?? "")} to ${crmStageLabel(e.to_value ?? "")}.`;
    case "held": return `Put on hold.${reason}`;
    case "resumed": return `Resumed${e.to_value ? ` (back to ${crmStageLabel(e.to_value)})` : ""}.`;
    case "won": {
      const [type, ...rest] = (e.reason ?? "").split(": ");
      const evidence = e.reason ? ` Confirmed by ${(EVIDENCE_WORDS[type ?? ""] ?? type ?? "evidence").toLowerCase()}${rest.length ? `: ${rest.join(": ")}` : ""}.` : "";
      return `Marked Won.${evidence}`;
    }
    case "lost": return `Marked Lost.${reason}`;
    case "owner_changed": return `Owner changed from ${personName(e.from_value)} to ${personName(e.to_value)}.${reason}`;
    case "value_changed": return `Value changed from ${e.from_value ?? "not set"} to ${e.to_value ?? "not set"}.`;
    case "details_changed": {
      const fields = (e.to_value ?? "").split(", ").filter(Boolean).map((f) => DETAIL_FIELD_LABELS[f] ?? f);
      return fields.length ? `Details changed: ${fields.join(", ")}.` : "Details changed.";
    }
    case "file": return `File or link recorded: ${e.to_value ?? ""}.`;
    case "proposal": return e.from_value ? `Proposal ${e.to_value ?? ""} (was ${e.from_value}).` : `Proposal ${e.to_value ?? ""}.`;
    case "availability": return `Equipment availability: ${AVAILABILITY_EVENT_WORDS[e.to_value ?? ""] ?? e.to_value ?? ""}.${reason}`;
    case "approval": return `Commercial ${APPROVAL_EVENT_WORDS[e.to_value ?? ""] ?? e.to_value ?? ""}.${reason}`;
    case "handover": return `Handover status: ${HANDOVER_STATUS_LABELS[e.to_value ?? ""] ?? e.to_value ?? ""}.`;
    default: return `${e.kind.replace(/_/g, " ")}${e.to_value ? `: ${e.to_value}` : ""}.`;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Follow-ups, stage preconditions, approval policy
// ---------------------------------------------------------------------------------------------------------------

/** True when completing this follow-up would leave an active opportunity with none: the database then requires a next step or a hold. */
export function isOnlyOpenFollowUp(followUps: readonly Pick<CrmFollowUpRow, "id" | "status">[], followUpId: string, stage: string): boolean {
  const open = followUps.filter((f) => f.status === "open");
  return isCrmActive(stage) && open.length === 1 && open[0]?.id === followUpId;
}

/** What the database insists on before a plain move, stated in words; null when the move has no extra requirement. */
export function stageMoveRequirement(to: string, ctx: { hasSentProposal: boolean; hasQuoteRef: boolean }): string | null {
  if (to === "proposal_sent" && !ctx.hasSentProposal) return "Record a proposal as sent first (Proposals & files tab).";
  if (to === "quote_sent" && !ctx.hasQuoteRef) return "Record the Zoho Books quote reference first (Commercial tab).";
  return null;
}

export const approvalPolicyOf = (settings: Pick<CrmCompanySettingsRow, "approval_policy"> | null | undefined): ApprovalPolicy => settings?.approval_policy ?? "not_configured";

// ---------------------------------------------------------------------------------------------------------------
// Reason text composed in the forms
// ---------------------------------------------------------------------------------------------------------------

export const OTHER_HOLD_REASON = "Other (note required)";
export const OTHER_LOST_REASON = "Other (write the reason)";

/** "Client postponed event" or "Client postponed event: venue moved"; the "Other" choice carries the note as the reason. */
export function composeReason(choice: string, note: string, otherChoice: string): string {
  const n = note.trim();
  if (choice === otherChoice) return n ? `Other: ${n}` : "";
  return n ? `${choice}: ${n}` : choice;
}

export const parseRisks = (text: string): string[] => text.split("\n").map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------------------------------------------------
// Files and proposals
// ---------------------------------------------------------------------------------------------------------------

export const FILE_PURPOSES: { id: CrmFileRow["purpose"]; label: string }[] = [
  { id: "proposal", label: "Proposal" },
  { id: "purchase_order", label: "Purchase order" },
  { id: "authorised_email", label: "Authorised email" },
  { id: "brief", label: "Client brief" },
  { id: "other", label: "Other" },
];

export const filePurposeLabel = (p: CrmFileRow["purpose"]) => FILE_PURPOSES.find((x) => x.id === p)?.label ?? p;

/** Files recorded as proposal, PO or authorised-email evidence say so; brief and other files say nothing extra. */
export function filePurposeNote(p: CrmFileRow["purpose"]): string | null {
  if (p === "proposal") return "Recorded as a proposal document";
  if (p === "purchase_order") return "Recorded as purchase order evidence";
  if (p === "authorised_email") return "Recorded as authorised email evidence";
  return null;
}

export const fileDisplayName = (f: Pick<CrmFileRow, "label" | "original_name" | "url">) => f.label?.trim() || f.original_name || f.url || "Untitled";

/** Only https links are ever rendered as clickable (the database stores only https; this guards anyway). */
export const isHttpsUrl = (url: string | null | undefined): url is string => {
  if (!url) return false;
  try { return new URL(url).protocol === "https:"; } catch { return false; }
};

export const PROPOSAL_STATUS_LABELS: Record<CrmProposalRow["status"], string> = { draft: "Draft", sent: "Sent", superseded: "Superseded", accepted: "Accepted" };
export const HANDOVER_STATUS_LABELS: Record<string, string> = { draft: "Draft", ready: "Ready for the Project Manager", handed_over: "Handed over" };

/** Which proposal actions the database allows for a proposal in this state (the UI offers only these). */
export function proposalActions(p: Pick<CrmProposalRow, "status">, stage: string): { send: boolean; accept: boolean; supersede: boolean } {
  if (stage === "lost") return { send: false, accept: false, supersede: false };
  if (stage === "won") return { send: false, accept: p.status === "sent", supersede: false };
  return { send: p.status === "draft", accept: p.status === "sent", supersede: p.status === "draft" || p.status === "sent" };
}

// ---------------------------------------------------------------------------------------------------------------
// Handover package: a summary of agreed facts taken from the opportunity, never a separate copy
// ---------------------------------------------------------------------------------------------------------------

export interface HandoverPackage {
  scope: string | null;
  exclusions: string | null;
  acceptedProposal: CrmProposalRow | null;
  acceptedProposalFile: CrmFileRow | null;
  evidenceLabel: string | null;
  evidenceReference: string | null;
  evidenceDate: string | null;
  evidenceFiles: CrmFileRow[];
  gaps: string[];
}

export function buildHandoverPackage(input: {
  opp: Pick<CrmOpportunityRow, "scope" | "exclusions" | "evidence_type" | "evidence_reference" | "evidence_date" | "payment_terms" | "technologies" | "install_start" | "event_start">;
  proposals: readonly CrmProposalRow[];
  files: readonly CrmFileRow[];
  contactCount: number;
  availability: AvailabilityDisplay;
}): HandoverPackage {
  const { opp } = input;
  const acceptedProposal = [...input.proposals].filter((p) => p.status === "accepted").sort((a, b) => b.version - a.version)[0] ?? null;
  const acceptedProposalFile = acceptedProposal?.file_id ? (input.files.find((f) => f.id === acceptedProposal.file_id) ?? null) : null;
  const evidenceFiles = input.files.filter((f) => f.purpose === "purchase_order" || f.purpose === "authorised_email");

  const gaps: string[] = [];
  if (input.availability === "needs_recheck") gaps.push("Equipment availability needs a recheck: the dates, technologies or quantities changed after the check.");
  else if (input.availability === "unavailable") gaps.push("Equipment was recorded as not available for these dates.");
  else if (input.availability !== "confirmed") gaps.push(`Equipment availability has not been confirmed (${AVAILABILITY_LABELS[input.availability].toLowerCase()}).`);
  if (!acceptedProposal) gaps.push("No accepted proposal is recorded.");
  if (!opp.scope?.trim()) gaps.push("The accepted scope is not written down.");
  if (!opp.payment_terms?.trim()) gaps.push("Payment terms are not recorded.");
  if (input.contactCount === 0) gaps.push("No contacts are linked.");
  if (!opp.install_start && !opp.event_start) gaps.push("No installation or show dates are recorded.");
  if (opp.technologies.length === 0) gaps.push("No technologies are listed.");
  if (evidenceFiles.length === 0) gaps.push("No purchase order or authorised-email file or link is attached (the reference is recorded, but the document is not).");

  return {
    scope: opp.scope,
    exclusions: opp.exclusions,
    acceptedProposal,
    acceptedProposalFile,
    evidenceLabel: opp.evidence_type === "purchase_order" ? "Purchase order" : opp.evidence_type === "authorised_email" ? "Authorised email" : null,
    evidenceReference: opp.evidence_reference,
    evidenceDate: opp.evidence_date,
    evidenceFiles,
    gaps,
  };
}

/** "10 Nov 2026 to 12 Nov 2026" / "10 Nov 2026" / null, from plain YYYY-MM-DD strings. */
export function dateRangeText(start: string | null, end: string | null, format: (d: string) => string): string | null {
  if (!start) return null;
  if (!end || end === start) return format(start);
  return `${format(start)} to ${format(end)}`;
}
