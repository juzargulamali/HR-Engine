/**
 * The project workspace has four primary sections; everything else is under "Manage project". Pure so the rule "what is offered
 * to whom" is tested. The database and the pages still enforce every one of these.
 */
export interface ProjectTabData {
  href: string;
  label: string;
  badge?: string | null;
}

export function projectTabs(base: string, unread: string | null): ProjectTabData[] {
  return [
    { href: base, label: "Overview" },
    { href: `${base}/work`, label: "Work" },
    { href: `${base}/plan`, label: "Plan" },
    { href: `${base}/discussion`, label: "Discussion", badge: unread },
  ];
}

/** Which tab a path belongs to. The overview matches only itself; the legacy section addresses light up their new home. */
export function activeTabHref(pathname: string, base: string): string | null {
  if (pathname === base) return base;
  const map: [string, string][] = [["/work", `${base}/work`], ["/plan", `${base}/plan`], ["/timeline", `${base}/plan`], ["/calendar", `${base}/plan`], ["/discussion", `${base}/discussion`]];
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
