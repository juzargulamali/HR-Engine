/**
 * Which organisations an inquiry field may offer. One organisation can hold several roles (agency, direct client, end client, technology
 * company), so the same record is offered in every field its roles fit. The database enforces the same rule (crm_opportunities_party_roles),
 * so a forged request is refused too. A record with no roles recorded reads as its legacy kind, exactly as the database reads it.
 */
export type InquiryField = "agency" | "client";

/** The agency field takes agencies; the end-client field takes end clients and direct clients. Technology companies are neither. */
export const FIELD_ROLES: Record<InquiryField, readonly string[]> = { agency: ["agency"], client: ["client", "direct"] };
export const FIELD_NOUN: Record<InquiryField, string> = { agency: "an agency", client: "an end client or direct client" };

export interface RoleBearing { id: string; kind: string; roles?: readonly string[] | null }

export const effectiveRoles = (o: Pick<RoleBearing, "kind" | "roles">): readonly string[] => (o.roles && o.roles.length > 0 ? o.roles : [o.kind]);
export const hasRoleFor = (o: Pick<RoleBearing, "kind" | "roles">, field: InquiryField): boolean => effectiveRoles(o).some((r) => FIELD_ROLES[field].includes(r));

/** What the picker for `field` lists: organisations with the role, plus the one already selected (an older inquiry keeps showing what it has). */
export const offeredFor = <T extends RoleBearing>(organisations: readonly T[], field: InquiryField, selectedId = ""): T[] =>
  organisations.filter((o) => hasRoleFor(o, field) || (selectedId !== "" && o.id === selectedId));
