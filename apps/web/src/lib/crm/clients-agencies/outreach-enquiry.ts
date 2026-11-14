import type { CrmOutreachEventRow } from "@/types/crm";
import { OUTREACH_EVENT_LABEL, OUTREACH_OUTCOME_LABEL } from "./outreach";

/**
 * Outreach to enquiry: the address of the New enquiry form with what the outreach already knows, so the person reviews and saves instead of
 * retyping. The form is the review step: nothing is created by following the link. `outreach` is linked to the new enquiry when it is saved
 * (crm_outreach_link_inquiry, called by the form's action), which is what stops a second enquiry being offered for the same outreach.
 *
 * No `source` is sent: the enquiry sources (CRM_SOURCES) have no value that means "from outreach", so the person chooses it on the form.
 */
export const ENQUIRY_TITLE_MAX = 200;   // the form's own limit on Requirement
export const ENQUIRY_BRIEF_MAX = 600;   // kept short: it travels in the address

const clip = (text: string, max: number): string => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

/** The newest logged call, email or meeting that has a note (events come oldest first, as `loadAccountOutreach` returns them). */
export function latestOutreachNote(events: readonly Pick<CrmOutreachEventRow, "kind" | "note" | "occurred_on" | "outcome">[]): { on: string; what: string; note: string } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if ((e.kind === "call" || e.kind === "email" || e.kind === "meeting") && e.note?.trim()) {
      return { on: e.occurred_on, what: `${OUTREACH_EVENT_LABEL[e.kind]}${e.outcome ? `, ${OUTREACH_OUTCOME_LABEL[e.outcome]}` : ""}`, note: e.note.trim() };
    }
  }
  return null;
}

export interface OutreachEnquiryInput {
  companyId: string;
  orgId: string;
  orgName: string;
  outreachId: string;
  objective: string | null;
  /** Sent only when it is certain who the enquiry is from: outreach holds no contact of its own, so this is the account's one recorded contact, or nothing. */
  contactId?: string | null;
  latestNote?: { on: string; what: string; note: string } | null;
}

export function outreachEnquiryTitle(orgName: string, objective: string | null): string {
  return clip(objective?.trim() ? `${orgName}: ${objective}` : `${orgName}: enquiry from outreach`, ENQUIRY_TITLE_MAX);
}

export function outreachEnquiryBrief(objective: string | null, latestNote?: { on: string; what: string; note: string } | null): string {
  const parts = [
    objective?.trim() ? `Outreach objective: ${objective.trim()}` : "",
    latestNote ? `Latest outreach note (${latestNote.on}, ${latestNote.what}): ${latestNote.note}` : "",
  ].filter(Boolean);
  return clip(parts.join("\n"), ENQUIRY_BRIEF_MAX);
}

/** `/sales/new?company&org&outreach&title[&contact][&brief]`: only what is known is sent, each value encoded. */
export function outreachEnquiryHref(i: OutreachEnquiryInput): string {
  const q = new URLSearchParams({ company: i.companyId, org: i.orgId, outreach: i.outreachId });
  if (i.contactId) q.set("contact", i.contactId);
  q.set("title", outreachEnquiryTitle(i.orgName, i.objective));
  const brief = outreachEnquiryBrief(i.objective, i.latestNote);
  if (brief) q.set("brief", brief);
  return `/sales/new?${q.toString()}`;
}
