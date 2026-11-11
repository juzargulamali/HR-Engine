/**
 * The project workspace has three primary sections (Work, Timeline, Equipment; the conversation is the project's group in Chat) and, for the people who may open it, a fifth (Budget); everything else is under "Manage project". Pure so the rule "what is offered
 * to whom" is tested. The database and the pages still enforce every one of these.
 */
export interface ProjectTabData {
  href: string;
  label: string;
  badge?: string | null;
}

/**
 * `discussion` is given ONLY on a database that does not have project chat groups yet: the old Discussion tab is then still the conversation. Once the groups exist the tab is not
 * offered; the conversation is the project's group in the app-wide Chat panel.
 */
export function projectTabs(base: string, discussion: { unread: string | null } | null, budget = false): ProjectTabData[] {
  return [
    { href: `${base}/work`, label: "Work" },
    { href: `${base}/plan`, label: "Timeline" },
    ...(discussion ? [{ href: `${base}/discussion`, label: "Discussion", badge: discussion.unread }] : []),
    { href: `${base}/equipment`, label: "Equipment" },
    // Project Budget & Expenses: offered only to the Project Manager and to people the module's own access rules let in (never inferred from Projects access).
    ...(budget ? [{ href: `${base}/budget`, label: "Budget" }] : []),
  ];
}

/** Which tab a path belongs to. The old overview address belongs to Work (its content lives there now); the legacy section addresses light up their new home. */
export function activeTabHref(pathname: string, base: string): string | null {
  if (pathname === base) return `${base}/work`;
  const map: [string, string][] = [["/work", `${base}/work`], ["/plan", `${base}/plan`], ["/timeline", `${base}/plan`], ["/calendar", `${base}/plan`], ["/discussion", `${base}/discussion`], ["/equipment", `${base}/equipment`], ["/budget", `${base}/budget`]];
  for (const [seg, href] of map) if (pathname === `${base}${seg}` || pathname.startsWith(`${base}${seg}/`)) return href;
  return null;
}

export type ManageAction = "edit" | "status" | "reopen";
export interface ManageItemData {
  key: string;
  label: string;
  href?: string;
  action?: ManageAction;
  hint?: string;
  separatorBefore?: boolean;
}

export interface ManageInput {
  base: string;
  /** PM, temporary leader or founder of this project. */
  manager: boolean;
  /** Not completed or archived. */
  live: boolean;
  /** Holds the reopen capability and the project is finished. */
  canReopen: boolean;
  /** There is at least one status move to offer. */
  hasStatusMoves: boolean;
}

export function manageItems(i: ManageInput): ManageItemData[] {
  const items: ManageItemData[] = [];
  if (i.manager && i.live) items.push({ key: "edit", label: "Edit details", action: "edit" });
  if (i.manager && i.hasStatusMoves) items.push({ key: "status", label: "Change status", action: "status" });
  items.push(
    { key: "people", label: "People & access", href: `${i.base}/people`, separatorBefore: items.length > 0 },
    { key: "changes", label: "Feedback & changes", href: `${i.base}/changes` },
    { key: "documents", label: "Files & client plan", href: `${i.base}/documents` },
    { key: "history", label: "History", href: `${i.base}/history` },
  );
  if (i.manager && i.live) items.push({ key: "complete", label: "Complete project", href: `${i.base}/complete`, hint: "Needs the client's confirmation", separatorBefore: true });
  if (i.canReopen) items.push({ key: "reopen", label: "Reopen project", action: "reopen", separatorBefore: !(i.manager && i.live) });
  return items;
}
