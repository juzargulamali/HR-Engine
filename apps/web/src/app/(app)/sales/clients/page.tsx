import Link from "next/link";
import { OsBadge } from "@/components/os/pills";
import { Building2, ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/workspace/states";
import { getCrmContext } from "@/lib/crm/context";
import { loadOrganisations } from "@/lib/crm/data";
import { pageSlice, pageWindow, pagingSentence } from "@/lib/crm/clients-agencies/paging";
import { cn } from "@/lib/utils";
import type { CrmContactRow } from "@/types/crm";
import { AddContactButton, ClientsToolbarActions } from "./client-actions";
import { OrganisationJump } from "./organisation-jump";

export const metadata = { title: "Clients & contacts" };

const KIND_LABEL = { agency: "Agency", client: "End client", direct: "Direct client" } as const;
const KIND_FILTERS = ["all", "agency", "client", "direct"] as const;
type KindFilter = (typeof KIND_FILTERS)[number];
/** Organisations per page. The list is read whole (lib/crm/data.ts `loadOrganisations`); a page is a slice of it and the sentence above the list names the slice and the whole. */
const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; org?: string; page?: string }> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const needle = q.toLowerCase();
  const kind: KindFilter = (KIND_FILTERS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as KindFilter) : "all";

  // One complete read (every organisation, every contact, every enquiry's parties, page by page): the contacts without an organisation come from the
  // same read, so there is no second, separately capped list to disagree with it. If it fails, the page says it could not load.
  let organisations: Awaited<ReturnType<typeof loadOrganisations>>["organisations"];
  let looseContacts: CrmContactRow[];
  try {
    const loaded = await loadOrganisations();
    organisations = loaded.organisations;
    looseContacts = loaded.unassignedContacts;
  } catch (e) {
    console.error("[crm] clients load failed", e);
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Clients &amp; contacts</h1>
        <LoadError what="clients and contacts" retryHref="/sales/clients" />
      </div>
    );
  }

  // One organisation chosen in the picker (or by "Show only this one"): it is shown alone with its contacts open, whatever the search says.
  const selected = sp.org && UUID.test(sp.org) ? (organisations.find((o) => o.id === sp.org) ?? null) : null;
  const matchesContact = (o: (typeof organisations)[number]) => needle !== "" && o.contacts.some((c) => contactText(c).includes(needle));
  const filtered = selected ? [selected] : organisations.filter((o) => {
    if (kind !== "all" && o.kind !== kind) return false;
    if (needle === "") return true;
    return `${o.name} ${o.place ?? ""} ${o.note ?? ""}`.toLowerCase().includes(needle) || matchesContact(o);
  });
  const win = pageWindow(filtered.length, sp.page, PAGE_SIZE);
  const shown = pageSlice(filtered, win);
  const unattached = selected ? [] : looseContacts.filter((c) => needle === "" || contactText(c).includes(needle));
  const contactTotal = organisations.reduce((n, o) => n + o.contacts.length, 0) + looseContacts.length;
  const filtering = needle !== "" || kind !== "all";
  const address = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: q || null, kind: kind === "all" ? null : kind, ...over })) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/sales/clients?${qs}` : "/sales/clients";
  };
  const pagerLink = "inline-flex min-h-10 items-center gap-1 rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary/60";
  const pager = win.pages > 1 ? (
    <nav aria-label="Pages of organisations" className="flex flex-wrap items-center gap-2" data-testid="clients-pager">
      {win.page > 1 ? <Link href={address({ page: win.page > 2 ? String(win.page - 1) : null })} className={pagerLink} rel="prev"><ChevronLeft className="h-4 w-4" aria-hidden /> Previous page</Link> : null}
      <span className="text-sm text-muted-foreground">Page {win.page} of {win.pages}</span>
      {win.page < win.pages ? <Link href={address({ page: String(win.page + 1) })} className={pagerLink} rel="next">Next page <ChevronRight className="h-4 w-4" aria-hidden /></Link> : null}
    </nav>
  ) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">
            Clients &amp; contacts
            <InfoHint label="Clients & contacts" className="ml-1.5">
              Agencies, end clients and the people at them, shared by every Enginious company. They are created as you record enquiries, or you can add them here. The enquiry counts are across the companies you have Sales access to. Owners, outreach and the per-company figures are in Clients &amp; Agencies.
            </InfoHint>
          </h1>
          <p className="text-sm text-muted-foreground">
            {organisations.length} {organisations.length === 1 ? "organisation" : "organisations"} · {contactTotal} {contactTotal === 1 ? "contact" : "contacts"}.
          </p>
        </div>
        <ClientsToolbarActions organisations={organisations.map((o) => ({ id: o.id, name: o.name }))} />
      </div>

      {organisations.length > 0 ? (
        <div className="max-w-xl">
          <OrganisationJump
            options={organisations.map((o) => ({ id: o.id, label: o.name, detail: [KIND_LABEL[o.kind], o.place].filter(Boolean).join(" · ") }))}
            selectedId={selected?.id ?? ""} query={address({}).split("?")[1] ?? ""}
          />
        </div>
      ) : null}

      {selected ? (
        <p className="text-sm" role="status" data-testid="clients-selected">
          Showing <span className="font-medium">{selected.name}</span> only. <Link href={address({})} className="underline underline-offset-2">Show {filtering ? "the search results" : "all organisations"}</Link>
        </p>
      ) : (
        <form method="get" role="search" aria-label="Search clients" className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-64 space-y-1.5">
            <label htmlFor="clients-q" className="text-sm font-medium leading-none">Search everything</label>
            <Input id="clients-q" name="q" type="search" defaultValue={q} placeholder="Organisation, place, note, contact, email or phone" />
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
      )}

      {organisations.length === 0 && looseContacts.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No clients yet"
          description="Agencies, end clients and contacts are created as you record enquiries, or you can add them here."
        />
      ) : filtered.length === 0 && unattached.length === 0 ? (
        <EmptyState icon={Building2} title="Nothing matches your search" description="Try a shorter search, or clear the type filter." action={<Link href="/sales/clients" className={buttonVariants({ variant: "outline", size: "sm" })}>Clear search</Link>} />
      ) : filtered.length > 0 ? (
        <>
          {selected ? null : (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="text-sm text-muted-foreground" role="status" data-testid="clients-count"><span className="font-medium text-foreground">{pagingSentence(win, "organisation", "organisations", filtering ? organisations.length : undefined)}</span>. Open a row to see its contacts.</p>
              {pager}
            </div>
          )}
          <ul className="space-y-2">
            {shown.map((o) => {
              const open = selected?.id === o.id || matchesContact(o) || filtered.length === 1;
              return (
                <li key={o.id}>
                  {/* A plain disclosure: the list stays short to scan, a row opens without a page load, and a search that matched a contact arrives already open. */}
                  <details className="os-card group" open={open} data-testid="clients-org">
                    <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <span title={o.name} className="min-w-0 flex-1 basis-48 break-words font-medium">{o.name}</span>
                      <OsBadge tone={o.kind === "agency" ? "blue" : o.kind === "client" ? "cyan" : "neutral"} className="whitespace-nowrap">{KIND_LABEL[o.kind]}</OsBadge>
                      <span className="text-sm text-muted-foreground">
                        {o.place ? `${o.place} · ` : ""}<span className={cn(o.openCount > 0 && "font-medium text-foreground")}>{o.openCount} open</span> of {o.opportunityCount} {o.opportunityCount === 1 ? "enquiry" : "enquiries"} · {o.contacts.length} {o.contacts.length === 1 ? "contact" : "contacts"}
                      </span>
                    </summary>
                    <div className="space-y-3 border-t border-border px-4 py-3">
                      {o.note ? <p className="break-words text-sm text-muted-foreground">{o.note}</p> : null}
                      {o.contacts.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No contacts recorded for this organisation yet.</p>
                      ) : (
                        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {o.contacts.map((c) => <li key={c.id} className="min-w-0"><ContactCard contact={c} /></li>)}
                        </ul>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <AddContactButton organisation={{ id: o.id, name: o.name }} />
                        <Link href={`/sales/accounts/${o.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Open account<span className="sr-only"> {o.name}</span></Link>
                        {selected ? null : <Link href={address({ org: o.id })} className={buttonVariants({ variant: "ghost", size: "sm" })}>Show only this one<span className="sr-only">: {o.name}</span></Link>}
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
          {selected || win.pages === 1 ? null : (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="text-sm text-muted-foreground">{pagingSentence(win, "organisation", "organisations")}</p>
              {pager}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground" role="status">No organisation matches your search. The contacts below do.</p>
      )}

      {unattached.length > 0 ? (
        <Card>
          <CardHeader className="pb-3"><CardTitle>Contacts without an organisation ({unattached.length})</CardTitle></CardHeader>
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
