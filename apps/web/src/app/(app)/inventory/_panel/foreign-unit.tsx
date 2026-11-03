import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { SidePanel } from "@/components/workspace/side-panel";
import { cn } from "@/lib/utils";
import { ownedByText, xUnitStatus, type XUnit } from "@/lib/inventory/xshare";
import { ConditionBadge, Section } from "./parts";

type Here = (patch?: Record<string, string | null>) => string;

/**
 * Another company's unit that is in transit to, or on the shelf at, a warehouse this person operates. Only the minimum needed to receive and handle
 * it (the database function decides, and returns no cost, supplier, note, history, employee or project): who owns it, its ID and serial number, what
 * it is, its condition, where it is, and the transfer it came on. The owner, ID and serial number never change when it moves.
 */
export function ForeignUnitPanel({ unit: u, closeHref, here, canOperate }: { unit: XUnit; closeHref: string; here: Here; canOperate: boolean }) {
  const rows: [string, React.ReactNode][] = [
    ["Equipment ID", <span key="c" className="font-mono">{u.code}</span>],
    ["Item", u.itemName],
    ...(u.category ? [["Category", u.category] as [string, React.ReactNode]] : []),
    ["Serial number", u.serial ?? "—"],
    ["Owned by", <span key="o">{u.ownerName}<span className="block text-[13px] text-muted-foreground">Moving equipment between warehouses never changes who owns it.</span></span>],
    ["Where it is", `${u.locationName} · ${u.locationCompanyId === u.ownerCompanyId ? u.ownerName : "your company"}`],
    ["Status", xUnitStatus(u)],
    ...(u.binCode ? [["Bin", u.binCode] as [string, React.ReactNode]] : []),
    ["Ownership", u.rented ? "Rented by the owner" : "Owned"],
  ];
  const quick: { label: string; href: string }[] = [];
  if (canOperate && u.custody === "transit" && u.transferId) quick.push({ label: "Receive the transfer", href: here({ action: "transfer", mode: "receive", transfer: u.transferId, unit: null, open: null }) });
  if (canOperate && u.custody === "warehouse" && u.usableHere) {
    quick.push({ label: "Issue to a person", href: here({ action: "issue", codes: u.code, unit: null, open: null }) });
    quick.push({ label: "Dispatch to a project", href: here({ action: "dispatch", codes: u.code, unit: null, open: null }) });
  }
  return (
    <SidePanel title={`${u.code} · ${u.itemName}`} subtitle={ownedByText(u.ownerName)} closeHref={closeHref}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <ConditionBadge condition={u.condition} />
          {u.rented ? <Badge variant="outline">Rented</Badge> : null}
          <span className="text-muted-foreground">{u.custody === "transit" ? "In transit" : "In the warehouse"}</span>
        </div>
        <Alert role="status">This equipment belongs to {u.ownerName}. You can see what is needed to receive and handle it here; its history, cost and other details stay with the owner.</Alert>
        {quick.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Unit actions">
            {quick.map((q) => <Link key={q.label} href={q.href} scroll={false} className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>{q.label}</Link>)}
          </div>
        ) : null}
        <Section title="About this unit">
          <dl className="divide-y divide-border rounded-md border border-border text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="grid gap-1 px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)]"><dt className="text-[13px] font-medium text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>
            ))}
          </dl>
        </Section>
        {u.transferId ? <Link href={`/inventory/transfers/${u.transferId}`} className="text-sm font-medium underline-offset-2 hover:underline">See the transfer {u.transferCode ?? ""}: dispatch, in transit, receipt</Link> : null}
      </div>
    </SidePanel>
  );
}
