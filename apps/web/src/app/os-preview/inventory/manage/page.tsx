"use client";

import { Boxes, ClipboardCheck, FileSpreadsheet, Layers, PackageSearch, Pencil, Users, Wrench } from "lucide-react";
import { InventoryFrame, PermissionNote } from "../../_components/inventory-bits";
import { PLink } from "../../_components/context";
import { StateGate } from "../../_components/ui";

const AREAS = [
  { icon: Boxes, title: "Catalogue", text: "Equipment types, categories, locations and bins. How an item is tracked is decided here, once, not at every movement.", who: "Catalogue managers" },
  { icon: Layers, title: "Technology templates", text: "What a “LED wall” or “line array” is made of, so Sales checks and requests can ask for it by name.", who: "Catalogue managers" },
  { icon: PackageSearch, title: "Opening stock", text: "Record what the warehouse already holds, and equipment that is already out, when you start.", who: "Stock confirmers" },
  { icon: ClipboardCheck, title: "Stock counts", text: "Count a shelf, compare with the records, confirm the differences.", who: "Warehouse operators; confirming needs a stock confirmer" },
  { icon: Wrench, title: "Repairs", text: "Send equipment for repair and receive it back. Held equipment is released after a condition check.", who: "Warehouse operators at that location" },
  { icon: Pencil, title: "Corrections", text: "Correct a counted quantity recorded by mistake. The original is kept; a new entry names it and gives a reason.", who: "Stock confirmers" },
  { icon: FileSpreadsheet, title: "Earlier asset register", text: "Import the previous HR equipment list.", who: "Founders" },
];

export default function Manage() {
  return (
    <InventoryFrame section="manage" title="Manage" description="Setup and corrections. Day-to-day warehouse work is under Today, Stock and History.">
      <StateGate what="inventory setup" emptyTitle="Nothing to manage" emptyText="No setup tasks are available to you." deniedWho="Setup is limited to catalogue managers, stock confirmers and founders.">
        <ul className="grid gap-3 md:grid-cols-2">
          {AREAS.map((a) => (
            <li key={a.title} className="rounded-lg border border-border bg-card p-4">
              <h2 className="flex items-center gap-2 font-heading text-sm font-semibold"><a.icon className="h-4 w-4 text-muted-foreground" aria-hidden />{a.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{a.text}</p>
              <div className="mt-2"><PermissionNote>{a.who}</PermissionNote></div>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Users className="h-4 w-4" aria-hidden />Who may do what in Inventory is managed in <PLink href="/os-preview/admin" className="text-[hsl(var(--os-link))] underline underline-offset-4">People &amp; Access</PLink>, not here.</p>
      </StateGate>
    </InventoryFrame>
  );
}
