import { buttonVariants } from "@/components/ui/button";
import { PanelLink } from "@/components/workspace/panel-link";
import { cn } from "@/lib/utils";

/**
 * The actions above the Stock list: Receive stock (the main one) and Give equipment, only for people who may operate stock somewhere (the
 * database still checks the location). Scanning is in the warehouse bar. Sending, returning and transferring are done where they belong: from
 * Today, from a request's workspace, or from the item itself. Each action opens a side panel through the address, so it can be linked to.
 */
export function StockHeaderActions({ hrefs, canOperate }: { hrefs: { receive: string; issue: string }; canOperate: boolean }) {
  if (!canOperate) return null;
  return (
    <>
      <PanelLink href={hrefs.receive} className={cn(buttonVariants(), "h-11 sm:h-9")}>Receive stock</PanelLink>
      <PanelLink href={hrefs.issue} className={cn(buttonVariants({ variant: "outline" }), "h-11 sm:h-9")}>Give equipment</PanelLink>
    </>
  );
}
