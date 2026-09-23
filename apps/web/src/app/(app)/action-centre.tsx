import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { CalendarClock, ClipboardCheck, FileClock, IdCard, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

type ActionItem = {
  key: string;
  icon: LucideIcon;
  label: string;
  count: number;
  href: string;
};

/**
 * "What requires my attention?" — each row is a real, permission-scoped
 * count linking to the page that already handles it in detail (Approvals
 * or Alerts). Deliberately doesn't re-implement those pages' itemized
 * tables here; duplicating that logic on the dashboard would just be a
 * second thing to keep in sync.
 */
export function ActionCentre({
  myPendingApprovals,
  contractsEndingCount,
  probationDueCount,
  docsExpiringCount,
  identityExpiringCount,
}: {
  myPendingApprovals: number;
  contractsEndingCount?: number;
  probationDueCount?: number;
  docsExpiringCount?: number;
  identityExpiringCount?: number;
}) {
  const items: ActionItem[] = [
    { key: "approvals", icon: ClipboardCheck, label: "Waiting on your decision", count: myPendingApprovals, href: "/approvals" },
    ...(contractsEndingCount !== undefined
      ? [{ key: "contracts", icon: CalendarClock, label: "Contracts ending soon", count: contractsEndingCount, href: "/alerts" }]
      : []),
    ...(probationDueCount !== undefined
      ? [{ key: "probation", icon: ShieldCheck, label: "Probation reviews due", count: probationDueCount, href: "/alerts" }]
      : []),
    ...(docsExpiringCount !== undefined
      ? [{ key: "docs", icon: FileClock, label: "Documents expiring or expired", count: docsExpiringCount, href: "/alerts" }]
      : []),
    ...(identityExpiringCount !== undefined
      ? [{ key: "identity", icon: IdCard, label: "Identity documents expiring soon", count: identityExpiringCount, href: "/alerts" }]
      : []),
  ].filter((item) => item.count > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs your attention</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState dense title="Nothing needs your attention right now." description="New approvals or expiring items will show up here." />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-2.5">
                    <item.icon className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                    {item.label}
                  </span>
                  <Badge variant={item.count > 0 ? "warning" : "secondary"}>{item.count}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
