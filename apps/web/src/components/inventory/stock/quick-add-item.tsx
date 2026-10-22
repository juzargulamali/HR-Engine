"use client";

import { QuickAdd } from "@/components/workspace/quick-add";
import { QuickAddItemForm, type CompanyChoice } from "./item-forms";

/** The one prominent Add of the Inventory page: a short form, everything else behind "Add more details". `?add=1` opens it. */
export function QuickAddItem({ companies }: { companies: CompanyChoice[] }) {
  return (
    <QuickAdd label="Add item" title="Add an item" description="Name it, say how it is tracked, and you can start receiving stock. Everything else can be added later." size="wide">
      {({ close }) => <QuickAddItemForm companies={companies} close={close} />}
    </QuickAdd>
  );
}
