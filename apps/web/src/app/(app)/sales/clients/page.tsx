import Link from "next/link";
import { Building2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { getCrmContext } from "@/lib/crm/context";
import { loadOrganisations } from "@/lib/crm/data";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { CrmContactRow } from "@/types/crm";
import { AddContactButton, ClientsToolbarActions } from "./client-actions";

export const metadata = { title: "Clients" };

const KIND_LABEL = { agency: "Agency", client: "End client", direct: "Direct client" } as const;
const KIND_FILTERS = ["all", "agency", "client", "direct"] as const;
type KindFilter = (typeof KIND_FILTERS)[number];
const PAGE_LIMIT = 100;

function ContactCard({ contact }: { contact: CrmContactRow }) {
  return (
    <div className="min-w-0 rounded-md border border-border p-3 text-sm">
      <p className="break-words font-medium">{contact.name}</p>
      {contact.role_title ? <p className="break-words text-muted-foreground">{contact.role_title}</p> : null}
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="w-12 flex-none text-sm text-muted-foreground">Email</dt>
          <dd className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {contact.email ? <a href={`mailto:${contact.email}`} className="break-all underline-offset-2 hover:underline">{contact.email}</a> : <span className="text-muted-foreground">Not recorded</span>}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-12 flex-none text-sm text-muted-foreground">Phone</dt>
          <dd className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {contact.phone ? <a href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`} className="break-words tabular-nums underline-offset-2 hover:underline">{contact.phone}</a> : <span className="text-muted-foreground">Not recorded</span>}
          </dd>
        </div>
      </dl>
    </div>
  );
}

const contactText = (c: CrmContactRow) => `${c.name} ${c.role_title ?? ""} ${c.email ?? ""} ${c.phone ?? ""}`.toLowerCase();

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const needle = q.toLowerCase();
  const kind: KindFilter = (KIND_FILTERS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as KindFilter) : "all";

  const supabase = await createClient();
  const [{ organisations }, { data: looseContacts }] = await Promise.all([
    loadOrganisations(),
    supabase.from("crm_contacts").select("*").is("organisation_id", null).is("archived_at", null).order("name"),
  ]);

  const filtered = organisations.filter((o) => {
    if (kind !== "all" && o.kind !== kind) return false;
    if (needle === "") return true;
    return `${o.name} ${o.place ?? ""} ${o.note ?? ""}`.toLowerCase().includes(needle) || o.contacts.some((c) => contactText(c).includes(needle));
  });
  const shown = filtered.slice(0, PAGE_LIMIT);
  const unattached = (looseContacts ?? []).filter((c) => needle === "" || contactText(c).includes(needle));
  const contactTotal = organisations.reduce((n, o) => n + o.contacts.length, 0) + (looseContacts ?? []).length;
  const filtering = needle !== "" || kind !== "all";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Clients &amp; contacts</h1>
          <p className="text-muted-foreground">
            Agencies, end clients and the people at them. {organisations.length} {organisations.length === 1 ? "organisation" : "organisations"} · {contactTotal} {contactTotal === 1 ? "contact" : "contacts"}.
          </p>
        </div>
        <ClientsToolbarActions organisations={organisations.map((o) => ({ id: o.id, name: o.name }))} />
      </div>

      <form method="get" role="search" aria-label="Search clients" className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64 space-y-1.5">
          <label htmlFor="clients-q" className="text-sm font-medium leading-none">Search</label>
          <Input id="clients-q" name="q" type="search" defaultValue={q} placeholder="Organisation, place, contact, email or phone" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="clients-kind" className="text-sm font-medium leading-none">Type</label>
          <Select id="clients-kind" name="kind" defaultValue={kind} className="w-44">
            <option value="all">All types</option>
            <option value="agency">Agencies</option>
            <option value="client">End clients</option>
            <option value="direct">Direct clients</option>
          </Select>
        </div>
        <Button type="submit" variant="secondary">Search</Button>
        {filtering ? <Link href="/sales/clients" className={cn(buttonVariants({ variant: "ghost" }))}>Clear</Link> : null}
      </form>

      {organisations.length === 0 && (looseContacts ?? []).length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No clients yet"
          description="Agencies, end clients and contacts are created as you record enquiries, or you can add them here."
        />
      ) : filtered.length === 0 && unattached.length === 0 ? (
        <EmptyState icon={Building2} title="Nothing matches your search" description="Try a shorter search, or clear the type filter." />
      ) : (
        <>
          {filtering ? <p className="text-sm text-muted-foreground" role="status">Showing {filtered.length} of {organisations.length} organisations.</p> : null}
          <ul className="space-y-4">
            {shown.map((o) => (
              <li key={o.id}>
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="break-words leading-snug">{o.name}</CardTitle>
                        {o.place ? <p className="mt-1 text-sm text-muted-foreground">{o.place}</p> : null}
                      </div>
                      <Badge variant="outline" className="whitespace-nowrap">{KIND_LABEL[o.kind]}</Badge>
                    </div>
                    <p className="text-sm">
                      <span className="font-medium">{o.openCount} open</span>
                      <span className="text-muted-foreground"> · {o.opportunityCount} {o.opportunityCount === 1 ? "opportunity" : "opportunities"} in total</span>
                    </p>
                    {o.note ? <p className="break-words text-sm text-muted-foreground">{o.note}</p> : null}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {o.contacts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No contacts recorded for this organisation yet.</p>
                    ) : (
                      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {o.contacts.map((c) => <li key={c.id} className="min-w-0"><ContactCard contact={c} /></li>)}
                      </ul>
                    )}
                    <AddContactButton organisation={{ id: o.id, name: o.name }} />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          {filtered.length > shown.length ? <Alert>Showing the first {PAGE_LIMIT} of {filtered.length} organisations. Search to narrow the list.</Alert> : null}
        </>
      )}

      {unattached.length > 0 ? (
        <Card>
          <CardHeader className="pb-3"><CardTitle>Contacts without an organisation</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {unattached.map((c) => <li key={c.id} className="min-w-0"><ContactCard contact={c} /></li>)}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
