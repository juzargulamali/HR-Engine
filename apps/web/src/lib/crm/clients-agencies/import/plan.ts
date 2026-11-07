import type { CrmLeadSource, CrmOrganisationRole } from "@/types/crm";
import type { DirectoryRow } from "../directory";
import { findOrganisationMatches, planEmptyFieldUpdate } from "../match";
import { countryLabel, LEAD_SOURCE_LABEL, normaliseEmail, ORGANISATION_ROLES, websiteDomain } from "../normalise";
import { resolveOwnerByEmail, type StaffPerson } from "../staff";
import type { ContactInput } from "../write";
import { rolesText, sameContact, type Flag, type ParsedFile, type ParsedOrg } from "./parse";

/** Compares what the file says with what is recorded and decides, per organisation, what is safe to do. Pure: no database access. */

export interface Conflict { field: string; existing: string; file: string }

export interface OrgPlan {
  key: string;
  name: string;
  rows: number[];
  kind: "new" | "existing" | "ambiguous";
  roles: CrmOrganisationRole[];
  /** Existing record this organisation matched (kind = existing). */
  match: { id: string; name: string; reasons: ("name" | "website")[] } | null;
  candidates: { id: string; name: string; reasons: ("name" | "website")[] }[];
  /** Fields of the shared record that are empty today and would be filled (only after confirm). */
  orgPatch: { roles?: CrmOrganisationRole[]; country_code?: string; website?: string; note?: string };
  profilePatch: { lead_source?: CrmLeadSource; exhibition?: string };
  /** A verified, eligible person to assign as account owner; null = leave as it is. */
  assignOwnerId: string | null;
  assignOwnerName: string | null;
  contactsToAdd: ContactInput[];
  contactsExisting: number;
  conflicts: Conflict[];
  /** Things a person must look at: they are never applied. */
  flags: Flag[];
  /** The new organisation's own values (kind = new). */
  incoming: { country_code: string | null; website: string | null; note: string | null; lead_source: CrmLeadSource | null; exhibition: string | null };
  hasChanges: boolean;
}

export interface PlanSummary {
  sourceRows: number;
  unnamedRows: number;
  rowErrors: number;
  exampleRows: number;
  duplicateRows: number;
  candidates: number;
  byType: Record<CrmOrganisationRole | "notRecorded", number>;
  newOrganisations: number;
  existingMatches: number;
  existingWithFills: number;
  existingNoChange: number;
  conflictOrganisations: number;
  conflictFields: number;
  ambiguous: number;
  contactsToAdd: number;
  contactsAlreadyThere: number;
  ownersToAssign: number;
  organisationsToReview: number;
  /** Organisations the confirm step would create or change. */
  safeActions: number;
}

export interface ImportPlan { orgs: OrgPlan[]; summary: PlanSummary }

export interface PlanContext {
  directory: readonly DirectoryRow[];
  staff: readonly StaffPerson[];
  companyId: string;
  /** The caller holds assign_owner for the company. Without it no owner is ever applied. */
  canAssign: boolean;
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

function resolveOwner(email: string | null, ctx: PlanContext): { id: string; name: string } | { flag: string } | null {
  if (!email) return null;
  if (!ctx.canAssign) return { flag: "Owner not applied: only a founder, or someone they delegated, can assign owners. The account stays as it is." };
  const e = normaliseEmail(email);
  if (!e) return { flag: "Owner could not be verified: that is not an e-mail address. The account stays Unassigned." };
  const hits = ctx.staff.filter((p) => normaliseEmail(p.email) === e);
  if (hits.length > 1) return { flag: "Owner could not be verified: more than one colleague has that e-mail. The account stays Unassigned." };
  const r = resolveOwnerByEmail(email, ctx.companyId, ctx.staff);
  if (r.status === "eligible") return { id: r.person.userId, name: r.person.name };
  if (r.status === "not_in_company") return { flag: "Owner could not be verified for this company: that colleague has no Sales access here. The account stays Unassigned." };
  if (r.status === "emails_hidden") return { flag: "Owner could not be verified: your access does not show colleagues' e-mail addresses. The account stays Unassigned." };
  return { flag: "Owner could not be verified: no colleague with Sales access to this company has that e-mail. The account stays Unassigned." };
}

function planOne(o: ParsedOrg, ctx: PlanContext, nameOf: (id: string | null) => string): OrgPlan {
  const flags = [...o.flags];
  const owner = resolveOwner(o.ownerEmail, ctx);
  if (owner && "flag" in owner) flags.push({ row: o.rows[0]!, kind: "owner", message: owner.flag });
  const eligible = owner && "id" in owner ? owner : null;
  const matches = findOrganisationMatches({ name: o.name, website: o.website }, ctx.directory.map((d) => d.org));
  const base = {
    key: o.key, name: o.name, rows: o.rows, roles: o.roles, flags, conflicts: [] as Conflict[], contactsToAdd: [] as ContactInput[], contactsExisting: 0,
    orgPatch: {} as OrgPlan["orgPatch"], profilePatch: {} as OrgPlan["profilePatch"], assignOwnerId: null as string | null, assignOwnerName: null as string | null,
    incoming: { country_code: o.countryCode, website: o.website, note: o.note, lead_source: o.leadSource, exhibition: o.exhibition },
  };
  const brief = (m: (typeof matches)[number]) => ({ id: m.organisation.id, name: m.organisation.name, reasons: m.reasons });

  if (matches.length === 0) {
    return { ...base, kind: "new", match: null, candidates: [], contactsToAdd: o.contacts, assignOwnerId: eligible?.id ?? null, assignOwnerName: eligible?.name ?? null, hasChanges: true };
  }
  // More than one candidate, or one that matched only by website under a different name: a person decides, nothing is merged.
  if (matches.length > 1 || !matches[0]!.reasons.includes("name")) {
    flags.push({ row: o.rows[0]!, kind: "file", message: matches.length > 1 ? "More than one existing organisation could be this one. Nothing was merged or changed." : "An existing organisation with a different name has the same website. Nothing was merged or changed." });
    return { ...base, kind: "ambiguous", match: null, candidates: matches.map(brief), hasChanges: false };
  }

  const row = ctx.directory.find((d) => d.org.id === matches[0]!.organisation.id)!;
  const existing = row.org;
  const conflicts: Conflict[] = [];
  const incomingWebsite = o.website && websiteDomain(existing.website) === websiteDomain(o.website) ? null : o.website;
  const incomingNote = o.note && (existing.note ?? "").includes(o.note) ? null : o.note;
  const { patch, skipped } = planEmptyFieldUpdate(existing, { roles: o.roles, country_code: o.countryCode, website: incomingWebsite, note: incomingNote });
  for (const f of skipped) {
    if (f === "country_code") conflicts.push({ field: "Country", existing: countryLabel(existing.country_code), file: countryLabel(o.countryCode) });
    else if (f === "website") conflicts.push({ field: "Website", existing: existing.website ?? "", file: o.website ?? "" });
    else if (f === "note") conflicts.push({ field: "Notes", existing: existing.note ?? "", file: o.note ?? "" });
    else if (f === "roles") conflicts.push({ field: "Type", existing: rolesText(existing.roles), file: rolesText(o.roles) });
  }
  const profilePatch: OrgPlan["profilePatch"] = {};
  const profile = row.profile;
  if (o.leadSource) {
    if (!profile?.lead_source) profilePatch.lead_source = o.leadSource;
    else if (profile.lead_source !== o.leadSource) conflicts.push({ field: "Lead source", existing: LEAD_SOURCE_LABEL[profile.lead_source], file: LEAD_SOURCE_LABEL[o.leadSource] });
  }
  if (o.exhibition) {
    if (!profile?.exhibition) profilePatch.exhibition = o.exhibition;
    else if (!same(profile.exhibition, o.exhibition)) conflicts.push({ field: "Exhibition", existing: profile.exhibition, file: o.exhibition });
  }
  let assignOwnerId: string | null = null;
  if (eligible) {
    if (!profile?.owner_id) assignOwnerId = eligible.id;
    else if (profile.owner_id !== eligible.id) conflicts.push({ field: "Account owner", existing: nameOf(profile.owner_id), file: eligible.name });
  }
  const contactsToAdd: ContactInput[] = [];
  let contactsExisting = 0;
  for (const c of o.contacts) {
    if (row.contacts.some((x) => sameContact(x, c))) contactsExisting++;
    else contactsToAdd.push(c);
  }
  const orgPatch = patch as OrgPlan["orgPatch"];
  const hasChanges = Object.keys(orgPatch).length > 0 || Object.keys(profilePatch).length > 0 || !!assignOwnerId || contactsToAdd.length > 0;
  return {
    ...base, kind: "existing", match: brief(matches[0]!), candidates: [], orgPatch, profilePatch, assignOwnerId, assignOwnerName: assignOwnerId ? eligible!.name : null,
    contactsToAdd, contactsExisting, conflicts, hasChanges,
  };
}

export function buildPlan(file: ParsedFile, ctx: PlanContext): ImportPlan {
  const nameOf = (id: string | null) => (id ? ctx.staff.find((p) => p.userId === id)?.name ?? "Another colleague" : "Unassigned");
  const orgs = file.orgs.map((o) => planOne(o, ctx, nameOf));
  const byType: PlanSummary["byType"] = { agency: 0, direct: 0, client: 0, technology: 0, notRecorded: 0 };
  for (const o of orgs) {
    if (o.roles.length === 0) byType.notRecorded++;
    for (const r of ORGANISATION_ROLES) if (o.roles.includes(r)) byType[r]++;
  }
  const existing = orgs.filter((o) => o.kind === "existing");
  const withConflicts = orgs.filter((o) => o.conflicts.length > 0);
  const summary: PlanSummary = {
    sourceRows: file.sourceRows, unnamedRows: file.unnamedRows.length, rowErrors: file.rowErrors.length, exampleRows: file.exampleRows, duplicateRows: file.duplicateRows.length,
    candidates: orgs.length, byType,
    newOrganisations: orgs.filter((o) => o.kind === "new").length,
    existingMatches: existing.length, existingWithFills: existing.filter((o) => o.hasChanges).length, existingNoChange: existing.filter((o) => !o.hasChanges).length,
    conflictOrganisations: withConflicts.length, conflictFields: withConflicts.reduce((n, o) => n + o.conflicts.length, 0),
    ambiguous: orgs.filter((o) => o.kind === "ambiguous").length,
    contactsToAdd: orgs.reduce((n, o) => n + o.contactsToAdd.length, 0), contactsAlreadyThere: orgs.reduce((n, o) => n + o.contactsExisting, 0),
    ownersToAssign: orgs.filter((o) => o.assignOwnerId).length,
    organisationsToReview: orgs.filter((o) => o.flags.length > 0 || o.conflicts.length > 0 || o.kind === "ambiguous").length,
    safeActions: orgs.filter((o) => o.kind !== "ambiguous" && o.hasChanges).length,
  };
  return { orgs, summary };
}
