"use client";

import { useRouter } from "next/navigation";
import { SearchCombobox, type ComboOption } from "@/components/sales/combobox";

/**
 * "Go to an organisation": the same search-as-you-type picker the enquiry forms use to choose an agency or a client, here used to open one
 * organisation's contacts. Choosing puts the organisation in the address (`org`), so the choice can be linked to and Back undoes it; clearing
 * the field returns to the list. `query` is the search and type filter in use, kept as they are.
 */
export function OrganisationJump({ options, selectedId, query }: { options: readonly ComboOption[]; selectedId: string; query: string }) {
  const router = useRouter();
  const go = (id: string) => {
    const q = new URLSearchParams(query);
    q.delete("page");
    if (id) q.set("org", id); else q.delete("org");
    const qs = q.toString();
    router.push(qs ? `/sales/clients?${qs}` : "/sales/clients");
  };
  return (
    <SearchCombobox
      id="clients-org" label="Go to an organisation" options={options} value={selectedId} onChange={go}
      placeholder="Type a name to see its contacts" emptyText={() => "No organisation with that name. Try the search below: it also looks in contacts, places and notes."}
    />
  );
}
