/**
 * Resumable employee setup: what is done and what remains after an employee record exists, derived from the records that already exist (contract versions,
 * compensation versions, identity and employee documents, opening-balance ledger rows, the linked login). Nothing is stored for it: opening the profile again,
 * on any device, reads the same answer. Pure functions: the loaders pass in counts, the screens render the result.
 *
 * A count of `null` means "the viewer cannot see these records" (row level security returned nothing or the read failed): the step is then hidden, never shown
 * as "to do", so a manager or the employee themself is not told that something is missing in a part they cannot see.
 */
export type SetupStepKey = "contract" | "compensation" | "documents" | "opening_balances" | "account";
export type SetupStatus = "done" | "todo" | "optional" | "not_applicable";

export interface SetupInput {
  employeeId: string;
  employmentStatus: "active" | "on_leave" | "suspended" | "terminated";
  removed: boolean;
  counts: {
    contracts: number | null;
    compensation: number | null;
    identityDocuments: number | null;
    employeeDocuments: number | null;
    /** Opening-balance rows in the leave ledger plus the comp-day ledger. */
    openingBalances: number | null;
  };
  linkedUserId: string | null;
  /** Whether the viewer may invite accounts (a System Administrator); an HR Admin can only link an account that already exists. */
  viewerCanInvite: boolean;
  /** Whether the viewer can open People & Access for this person at all. */
  viewerCanOpenAccess: boolean;
}

export interface SetupStep {
  key: SetupStepKey;
  label: string;
  status: SetupStatus;
  /** One readable sentence: what is on record, or what is missing and what saving will do. */
  detail: string;
  /** The form or screen that completes the step, with the employee already chosen. Null when there is nothing to open (done, or not applicable). */
  href: string | null;
  actionLabel: string | null;
}

const tab = (id: string, t: string, step?: string) => `/employees/${id}?tab=${t}${step ? `&step=${step}` : ""}`;

export function peopleAccessHref(linkedUserId: string | null, employeeId: string, tabName: "account" | "roles" | "modules" | "job" = "account"): string {
  const person = linkedUserId ? `u:${linkedUserId}` : `e:${employeeId}`;
  return `/people-access?person=${encodeURIComponent(person)}&tab=${tabName}`;
}

export function computeSetup(i: SetupInput): SetupStep[] {
  const inactive = i.removed || i.employmentStatus === "terminated";
  const na = (key: SetupStepKey, label: string): SetupStep => ({ key, label, status: "not_applicable", detail: i.removed ? "Not applicable: this record was removed." : "Not applicable: this person has left.", href: null, actionLabel: null });
  const steps: SetupStep[] = [];

  if (i.counts.contracts !== null) {
    steps.push(inactive ? na("contract", "Contract") : i.counts.contracts > 0
      ? { key: "contract", label: "Contract", status: "done", detail: "A contract is on record.", href: null, actionLabel: null }
      : { key: "contract", label: "Contract", status: "todo", detail: "No contract yet. Saving adds contract version 1 for this employee.", href: tab(i.employeeId, "employment", "contract"), actionLabel: "Add contract" });
  }
  if (i.counts.compensation !== null) {
    steps.push(inactive ? na("compensation", "Compensation") : i.counts.compensation > 0
      ? { key: "compensation", label: "Compensation", status: "done", detail: "Salary is on record.", href: null, actionLabel: null }
      : { key: "compensation", label: "Compensation", status: "todo", detail: "No salary yet. Saving records the first salary, effective from the hire date unless you choose another date.", href: tab(i.employeeId, "employment", "pay"), actionLabel: "Add salary" });
  }
  if (i.counts.identityDocuments !== null || i.counts.employeeDocuments !== null) {
    const n = (i.counts.identityDocuments ?? 0) + (i.counts.employeeDocuments ?? 0);
    steps.push(inactive ? na("documents", "Documents") : n > 0
      ? { key: "documents", label: "Documents", status: "done", detail: n === 1 ? "1 document is on file." : `${n} documents are on file.`, href: null, actionLabel: null }
      : { key: "documents", label: "Documents", status: "todo", detail: "No document on file. Add the identity document first; the form asks for what its type needs.", href: tab(i.employeeId, "documents", "documents"), actionLabel: "Add document" });
  }
  if (i.counts.openingBalances !== null) {
    steps.push(inactive ? na("opening_balances", "Opening balances") : i.counts.openingBalances > 0
      ? { key: "opening_balances", label: "Opening balances", status: "done", detail: "Opening balances were recorded once; they are not repeated.", href: null, actionLabel: null }
      : { key: "opening_balances", label: "Opening balances", status: "optional", detail: "Optional: only for someone who already has leave or comp days from elsewhere. A fresh start needs nothing.", href: tab(i.employeeId, "leave", "opening-balances"), actionLabel: "Record opening balances" });
  }
  // The account step is visible to whoever may manage accounts or HR records; its count is not a record count, so it is always known.
  steps.push(inactive ? na("account", "Account invitation") : i.linkedUserId
    ? { key: "account", label: "Account invitation", status: "done", detail: "A login is linked, so this person sees their own profile, leave and approvals.", href: i.viewerCanOpenAccess ? peopleAccessHref(i.linkedUserId, i.employeeId, "account") : null, actionLabel: i.viewerCanOpenAccess ? "Open People & Access" : null }
    : i.viewerCanInvite
      ? { key: "account", label: "Account invitation", status: "todo", detail: "No login yet. Invite them in People & Access, then link the account here.", href: peopleAccessHref(null, i.employeeId, "account"), actionLabel: "Open People & Access" }
      : { key: "account", label: "Account invitation", status: "todo", detail: "No login yet. A System Administrator invites them in People & Access; once the account exists you link it here.", href: tab(i.employeeId, "overview", "account"), actionLabel: "Link an account" });
  return steps;
}

/** Steps that still need doing. `optional` is not counted: an optional step never makes a record look unfinished. */
export const remainingSteps = (steps: readonly SetupStep[]) => steps.filter((s) => s.status === "todo");

export function setupSummary(steps: readonly SetupStep[]): { remaining: number; total: number; text: string } {
  const counted = steps.filter((s) => s.status !== "not_applicable" && s.status !== "optional");
  const remaining = counted.filter((s) => s.status === "todo").length;
  const total = counted.length;
  if (total === 0) return { remaining: 0, total: 0, text: "" };
  return { remaining, total, text: remaining === 0 ? "Setup complete" : `${remaining} of ${total} setup steps to do` };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Exceptions: the short, actionable flags the directory and the overview show for one employee. Only what the viewer can see is ever passed in.
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export interface ExceptionInput {
  employeeId: string;
  employmentStatus: "active" | "on_leave" | "suspended" | "terminated";
  removed: boolean;
  jobTitle: string | null;
  managerId: string | null;
  /** The person is at the top of the organisation (CEO/CTO) or the viewer cannot tell; "No manager" is only said when it is known. */
  managerNotExpected: boolean;
  steps: readonly SetupStep[];
  expiredDocuments: number | null;
  expiringDocuments: number | null;
  scheduledChanges: number | null;
  /** Scheduled changes the daily job held back because pay moved on (a subset of `scheduledChanges`); null when not known. */
  heldChanges?: number | null;
}

export interface Exception { key: string; label: string; tone: "attention" | "info"; href: string }

export function computeExceptions(i: ExceptionInput): Exception[] {
  if (i.removed || i.employmentStatus === "terminated") return [];
  const out: Exception[] = [];
  const profile = `/employees/${i.employeeId}`;
  const s = setupSummary(i.steps);
  if (s.total > 0 && s.remaining > 0) {
    const first = remainingSteps(i.steps)[0];
    out.push({ key: "setup", label: s.text, tone: "attention", href: first?.href ?? profile });
  }
  if (!i.managerId && !i.managerNotExpected && i.employmentStatus === "active") out.push({ key: "manager", label: "No manager", tone: "attention", href: `${profile}?tab=overview&step=job` });
  if (!i.jobTitle) out.push({ key: "job", label: "No job title", tone: "attention", href: `${profile}?tab=overview&step=job` });
  if (i.expiredDocuments) out.push({ key: "expired", label: i.expiredDocuments === 1 ? "1 document expired" : `${i.expiredDocuments} documents expired`, tone: "attention", href: `${profile}?tab=documents` });
  else if (i.expiringDocuments) out.push({ key: "expiring", label: i.expiringDocuments === 1 ? "1 document expiring soon" : `${i.expiringDocuments} documents expiring soon`, tone: "info", href: `${profile}?tab=documents` });
  if (i.heldChanges) out.push({ key: "held", label: i.heldChanges === 1 ? "1 scheduled change held for review" : `${i.heldChanges} scheduled changes held for review`, tone: "attention", href: `${profile}?tab=employment` });
  // A held change is counted once, as held; the plain "scheduled" flag is for the ones simply waiting for their date.
  const waiting = (i.scheduledChanges ?? 0) - (i.heldChanges ?? 0);
  if (waiting > 0) out.push({ key: "scheduled", label: waiting === 1 ? "1 scheduled change" : `${waiting} scheduled changes`, tone: "info", href: `${profile}?tab=employment` });
  return out;
}
