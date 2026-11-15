/**
 * The agency, the designated site contact and the notes of a Sales to Projects handover, as the database returns them
 * (20270112000100_proj_handover_parties.sql). Pure types and wording here; the reads are in handover-parties-data.ts.
 *
 * The database decides who gets what: proj_handover_parties (the people who work the handover) and proj_project_handover (what the project shows:
 * always the ACCEPTED brief, with the contact only for whoever manages the project and for Operations Managers).
 */

export interface SiteContact { contactId: string | null; name: string; roleTitle: string | null; phone: string | null; email: string | null; takenAt: string | null }

/** `recorded` false = the brief was last submitted or accepted before the agency and the contact were recorded at handover: nothing is known, so nothing is claimed. */
export interface HandoverParties { recorded: boolean; jobType: "direct" | "agency" | null; agencyName: string | null; siteContact: SiteContact | null }

export interface ProjectHandoverDetails extends HandoverParties {
  hasHandover: boolean; acceptedAt: string | null; notes: string | null;
  /** True when this person may not see the contact (a team member who does not manage the project). No contact field was sent at all. */
  contactRestricted: boolean;
}

/** "none": the database does not have these functions yet (the migration is not applied), so the screen shows what it showed before. "error": a read failed. */
export type PartiesRead = { status: "none" } | { status: "error" } | { status: "ok"; parties: HandoverParties };
export type ProjectHandoverRead = { status: "none" } | { status: "error" } | { status: "ok"; details: ProjectHandoverDetails };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

export function parseSiteContact(raw: unknown): SiteContact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = text(r.name);
  if (!name) return null;
  return { contactId: text(r.contact_id), name, roleTitle: text(r.role_title), phone: text(r.phone), email: text(r.email), takenAt: text(r.taken_at) };
}

export function parseParties(raw: unknown): HandoverParties | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  // An answer without the "recorded" fact (or, for a project, the "has_handover" fact) is not one of ours: it is a failed read, never "not recorded".
  if (typeof r.recorded !== "boolean" && typeof r.has_handover !== "boolean") return null;
  const jobType = r.job_type === "direct" || r.job_type === "agency" ? r.job_type : null;
  return { recorded: r.recorded === true, jobType, agencyName: text(r.agency_name), siteContact: parseSiteContact(r.site_contact) };
}

export function parseProjectHandover(raw: unknown): ProjectHandoverDetails | null {
  const p = parseParties(raw);
  if (!p) return null;
  const r = raw as Record<string, unknown>;
  return { ...p, hasHandover: r.has_handover === true, acceptedAt: text(r.accepted_at), notes: text(r.notes), contactRestricted: r.contact_restricted === true };
}

export const NOT_RECORDED = "Not recorded at handover";

/** The agency line, in words. A direct job says so; a brief from before the change says it was not recorded (never "direct" on a guess). */
export function agencyWords(p: Pick<HandoverParties, "recorded" | "jobType" | "agencyName">): string {
  if (!p.recorded || !p.jobType) return NOT_RECORDED;
  if (p.jobType === "direct") return "None: a direct job";
  return p.agencyName ?? "An agency (its name was not recorded)";
}

/** The site contact line when there is no contact to show. */
export function noContactWords(p: Pick<HandoverParties, "recorded">, restricted = false): string {
  if (restricted) return "Shown to the Project Manager and Operations";
  return p.recorded ? "None chosen at handover" : NOT_RECORDED;
}
