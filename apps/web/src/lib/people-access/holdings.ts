/**
 * What an account still holds, as the database reports it before a System Administrator deactivates it (account_holdings). Nothing here is re-routed or removed
 * by deactivating: pending approvals stay with the person until someone changes who decides, and the screen says so.
 */
export interface AccountHoldings {
  blockers: string[];
  pendingApprovals: { entityType: string; count: number }[];
  projects: { reference: string; role: "pm" | "acting_pm" }[];
  teamsHeaded: { project: string; team: string }[];
  roles: { role: string; company: string | null }[];
  moduleAccess: { module: string; company: string }[];
  equipmentHeld: number;
}

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Defensive parse of the database's JSON (a missing key reads as nothing held, a missing `blockers` is treated as unknown by the caller). */
export function parseHoldings(raw: unknown): AccountHoldings | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.blockers)) return null;
  return {
    blockers: asArray<string>(r.blockers).filter((b) => typeof b === "string"),
    pendingApprovals: asArray<{ entity_type: string; count: number }>(r.pending_approvals).map((a) => ({ entityType: a.entity_type, count: Number(a.count) })),
    projects: [...asArray<{ reference: string }>(r.projects_managed).map((p) => ({ reference: p.reference, role: "pm" as const })), ...asArray<{ reference: string }>(r.projects_acting).map((p) => ({ reference: p.reference, role: "acting_pm" as const }))],
    teamsHeaded: asArray<{ project: string; team: string }>(r.teams_headed),
    roles: asArray<{ role: string; company: string | null }>(r.roles),
    moduleAccess: asArray<{ module: string; company: string }>(r.module_access),
    equipmentHeld: Number(r.equipment_held ?? 0),
  };
}

const APPROVAL_LABEL: Record<string, string> = {
  leave_request: "leave request", reimbursement_claim: "expense claim", timesheet: "timesheet", generated_letter: "letter",
  payroll_export_run: "payroll run", recovery_credit: "Recovery Leave request",
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The plain-English lines shown to the System Administrator; an empty list means the account holds nothing the screen needs to warn about. */
export function describeHoldings(h: AccountHoldings): string[] {
  const lines: string[] = [];
  const approvals = h.pendingApprovals.reduce((n, a) => n + a.count, 0);
  if (approvals > 0) {
    const by = h.pendingApprovals.map((a) => plural(a.count, APPROVAL_LABEL[a.entityType] ?? a.entityType.replace(/_/g, " "))).join(", ");
    lines.push(`${plural(approvals, "approval")} waiting on this person (${by}). They stay with this person: nothing is re-routed automatically, so someone has to change who decides.`);
  }
  const pm = h.projects.filter((p) => p.role === "pm");
  const acting = h.projects.filter((p) => p.role === "acting_pm");
  if (pm.length > 0) lines.push(`Project Manager of ${plural(pm.length, "live project")}: ${pm.map((p) => p.reference).join(", ")}.`);
  if (acting.length > 0) lines.push(`Acting Project Manager of ${plural(acting.length, "live project")}: ${acting.map((p) => p.reference).join(", ")}.`);
  if (h.teamsHeaded.length > 0) lines.push(`Heads ${plural(h.teamsHeaded.length, "project team")}: ${h.teamsHeaded.map((t) => `${t.team} (${t.project})`).join(", ")}.`);
  if (h.roles.length > 0) lines.push(`HR roles: ${h.roles.map((r) => `${r.role.replace(/_/g, " ")}${r.company ? ` (${r.company})` : ""}`).join(", ")}.`);
  if (h.moduleAccess.length > 0) lines.push(`Module access: ${h.moduleAccess.map((m) => `${m.module} (${m.company})`).join(", ")}.`);
  if (h.equipmentHeld > 0) lines.push(`${plural(h.equipmentHeld, "item")} of equipment issued to this person.`);
  return lines;
}
