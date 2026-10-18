"use client";

import { useState } from "react";
import { Building2, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { CONTACTS, OPPORTUNITIES, ORGS, orgById, personName, type Org, type OrgType } from "../../_lib/data";
import { PLink } from "../../_components/context";
import { ContactCard } from "../../_components/contact-card";
import { Chip, PageHeader, Panel, ScrollRow, StageChip, StateGate } from "../../_components/ui";
import { SegmentedControl } from "@/components/ui/segmented-control";

const TYPE_LABEL: Record<OrgType, string> = { agency: "Agency", client: "End client", direct: "Direct client" };
type Filter = "all" | OrgType;

export default function Clients() {
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string>("o-northwind");
  const list = ORGS.filter((o) => filter === "all" || o.type === filter);
  const org: Org = orgById(selected);
  const contacts = CONTACTS.filter((c) => c.orgId === org.id);
  const opps = OPPORTUNITIES.filter((o) => o.agencyId === org.id || o.endClientId === org.id);
  const endClients = org.type === "agency" ? [...new Set(OPPORTUNITIES.filter((o) => o.agencyId === org.id && o.endClientId).map((o) => o.endClientId!))].map(orgById) : [];
  const agencies = org.type !== "agency" ? [...new Set(OPPORTUNITIES.filter((o) => o.endClientId === org.id && o.agencyId).map((o) => o.agencyId!))].map(orgById) : [];

  return (
    <>
      <PageHeader eyebrow="Sales & CRM" title="Clients & contacts" />
      <StateGate what="clients" emptyTitle="No clients yet" emptyText="Agencies, end clients and contacts are created as you record enquiries, or added here.">
        <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <div className="min-w-0">
            <ScrollRow label="organisation types" className="mb-3"><SegmentedControl<Filter> aria-label="Filter organisations" value={filter} onChange={setFilter} className="min-w-max" options={[{ value: "all", label: "All" }, { value: "agency", label: "Agencies" }, { value: "client", label: "End clients" }, { value: "direct", label: "Direct" }]} /></ScrollRow>
            <ul className="max-h-[32rem] space-y-1 overflow-y-auto rounded-lg border border-border bg-card p-1.5">
              {list.map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => setSelected(o.id)} aria-current={selected === o.id ? "true" : undefined} className={cn("flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selected === o.id ? "bg-accent/10" : "hover:bg-secondary/60")}>
                    <Building2 className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{o.name}</span><span className="block truncate text-xs text-muted-foreground">{o.place}</span></span>
                    <Chip>{TYPE_LABEL[o.type]}</Chip>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0 space-y-6">
            <Panel>
              <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-heading text-lg font-semibold">{org.name}</h2><p className="text-sm text-muted-foreground">{org.place}</p></div><Chip tone="info">{TYPE_LABEL[org.type]}</Chip></div>
              <p className="mt-2 text-sm">{org.note}</p>
              {endClients.length ? <p className="mt-3 text-sm"><span className="text-muted-foreground">End clients served through this agency:</span> {endClients.map((c) => c.name).join(", ")}</p> : null}
              {agencies.length ? <p className="mt-3 text-sm"><span className="text-muted-foreground">Comes to us through:</span> {agencies.map((c) => c.name).join(", ")}</p> : null}
            </Panel>
            <Panel title="Contacts">
              {contacts.length === 0 ? <p className="text-sm text-muted-foreground">No contacts recorded for this organisation yet.</p> : (
                <div className="grid gap-3 xl:grid-cols-2">
                  {contacts.map((c) => (
                    <div key={c.id} className="space-y-1.5">
                      <ContactCard contact={c} />
                      <p className="flex flex-wrap gap-1.5 text-xs">{OPPORTUNITIES.flatMap((o) => o.contacts.filter((x) => x.contactId === c.id).map((x) => ({ o, role: x.role }))).map((x) => <Chip key={x.o.id}>{x.role} on {x.o.ref}</Chip>)}</p>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            <Panel title="Opportunities" flush>
              {opps.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">No opportunities with this organisation yet.</p> : (
                <ul className="divide-y divide-border/70">
                  {opps.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"><div className="min-w-0 flex-1"><PLink href={`/os-preview/sales/opportunities/${o.ref}`} className="text-sm font-medium hover:underline">{o.title}</PLink><p className="text-xs text-muted-foreground">{o.ref} · Owner {personName(o.owner)}</p></div><StageChip stage={o.stage} /></li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </StateGate>
    </>
  );
}
