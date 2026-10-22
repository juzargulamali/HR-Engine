import { ScanLine } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { MoreMenu } from "@/components/workspace/more-menu";
import { PanelLink } from "@/components/workspace/panel-link";
import { cn } from "@/lib/utils";

/**
 * The actions in the Inventory page header: Scan for everyone, the stock movements only for people who may operate stock somewhere
 * (the database still checks the location). Each one opens a side panel through the address, so it can be linked to and Back closes it.
 */
export function StockHeaderActions({ hrefs, canOperate }: { hrefs: { scan: string; receive: string; issue: string; dispatch: string; return: string; transfer: string }; canOperate: boolean }) {
  const secondary = cn(buttonVariants({ variant: "outline" }));
  return (
    <>
      <PanelLink href={hrefs.scan} className={secondary}><ScanLine className="h-4 w-4" aria-hidden /> Scan</PanelLink>
      {canOperate ? (
        <>
          <PanelLink href={hrefs.receive} className={secondary}>Receive stock</PanelLink>
          <MoreMenu label="Issue / Dispatch" items={[
            { key: "issue", label: "Issue to a person", hint: "Give equipment to an employee", href: hrefs.issue },
            { key: "dispatch", label: "Dispatch to a project", hint: "Send equipment out for a project", href: hrefs.dispatch },
          ]} />
          <PanelLink href={hrefs.return} className={secondary}>Return</PanelLink>
          <PanelLink href={hrefs.transfer} className={secondary}>Transfer</PanelLink>
        </>
      ) : null}
    </>
  );
}
