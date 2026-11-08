import Link from "next/link";
import { notFound } from "next/navigation";
import { hasCrmCapability, isCrmFounder } from "@enginious-hr/domain";
import { OsBadge } from "@/components/os/pills";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadError } from "@/components/workspace/states";
import { StageBadge, DueText } from "@/components/sales/badges";
import { formatDate, formatDateTime } from "@/components/sales/format";
import { getCrmContext } from "@/lib/crm/context";
import { loadAccount, loadStaff, type AccountPage } from "@/lib/crm/clients-agencies/data";
import { loadAccountOutreach, type AccountOutreach } from "@/lib/crm/clients-agencies/outreach-data";
import { OutreachSection } from "../../outreach/outreach-section";
import { todayInDubai } from "@/components/sales/format";
import { COUNT_DEFINITIONS, type InquiryRow } from "@/lib/crm/clients-agencies/account";
import { selectCompany } from "@/lib/crm/clients-agencies/company";
import { countryLabel, LEAD_SOURCE_LABEL, ROLE_LABEL } from "@/lib/crm/clients-agencies/normalise";
import { eligibleStaff, type StaffPerson } from "@/lib/crm/clients-agencies/staff";
import { AddAccountContactButton, EditAccountButton, EditAccountContactButton } from "../account-forms";
import { AddAccountFollowUpButton, AddFollowUpButton, AssignOwnerButton, ReassignFollowUpButton } from "../owner-and-follow-ups";

export const metadata = { title: "Account" };

const NO_ACTIVITY = "No activity recorded in CRM.";
const ACTIVITY_LABEL: Record<string, string> = { call: "Call", email: "Email", meeting: "Meeting", note: "Note", client_response: "Client response" };

function routeText(i: InquiryRow, names: Map<string, string>): string {
  const other = i.counterpartId ? (names.get(i.counterpartId) ?? "another organisation") : null;
  if (i.route === "direct") return "Direct";
  if (i.route === "through_agency") return `Through agency: ${other}`;
  return other ? `As the agency, for ${other}` : "As the agency (end client not recorded)";
}

function projectText(p: InquiryRow["project"]): string {
  switch (p.kind) {
    case "project": return `${p.reference}: ${p.completed ? "Completed" : p.status.replace(/_/g, " ")}`;
    case "handover": return p.status === "accepted" ? "Project exists; status not visible to you" : `Handover ${p.status.replace(/_/g, " ")}`;
    case "unknown": return "Could not load";
    default: return "—";
  }
}

export default async function AccountPageRoute({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ company?: string; outreach_link?: string }> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const company = selectCompany(ctx.companies, sp.company);
  const back = <Link href={`/sales/accounts${company ? `?company=${company.id}` : ""}`} className="text-sm underline-offset-2 hover:underline">← Clients &amp; Agencies</Link>;
  if (!company) return <div className="space-y-4">{back}<LoadError what="this account" /></div>;

  let data: AccountPage | null;
  let staff: StaffPerson[];
  try {
    [data, staff] = await Promise.all([loadAccount(ctx, company.id, id), loadStaff()]);
  } catch (e) {
    console.error("[clients-agencies] account failed", e);
    return <div className="space-y-4">{back}<LoadError what="this account" retryHref={`/sales/accounts/${id}?company=${company.id}`} /></div>;
  }
  if (!data) notFound();
  // Outreach fails softly into its own "could not load" section; the rest of the account still shows.
  const outreach: AccountOutreach[] | "error" = await loadAccountOutreach(company.id, id).catch((e) => { console.error("[clients-agencies] outreach failed", e); return "error" as const; });
  const { org, contacts, profile, view, orgNames } = data;
  const people = eligibleStaff(staff, company.id).map((p) => ({ id: p.userId, name: p.name }));
  const nameOf = (uid: string | null) => (uid ? (staff.find((p) => p.userId === uid)?.name ?? ctx.personName(uid)) : null);
  const canAssign = hasCrmCapability(ctx.grants, company.id, "assign_owner");
  const founder = isCrmFounder(ctx.grants, company.id);
  const owner = nameOf(profile?.owner_id ?? null);
  const c = view.counts;
  const openInquiries = view.inquiries.filter((i) => i.opp.stage !== "won" && i.opp.stage !== "lost");
  const formValues = { name: org.name, roles: org.roles, country: org.country_code ?? "", website: org.website ?? "", vatTrn: org.vat_trn ?? "", tradeLicence: org.trade_licence_no ?? "", place: org.place ?? "", note: org.note ?? "", leadSource: profile?.lead_source ?? "", exhibition: profile?.exhibition ?? "" } as const;

  const followUpsCard = (
      <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Follow-ups ({c.openFollowUps} open{c.overdueFollowUps ? `, ${c.overdueFollowUps} overdue` : ""})</CardTitle>
          {openInquiries.length > 0
            ? <AddFollowUpButton inquiries={openInquiries.map((i) => ({ id: i.opp.id, label: `${i.opp.reference}: ${i.opp.title}` }))} people={people} defaultAssigneeId={ctx.userId} />
            : <AddAccountFollowUpButton orgId={org.id} companyId={company.id} people={people} currentUserId={ctx.userId} canAssign={canAssign} />}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {view.followUps.length === 0 && view.accountFollowUps.length === 0 ? <p className="text-sm text-muted-foreground">No open follow-ups.</p> : (
          <ul className="divide-y divide-border">
            {view.followUps.map(({ followUp: f, opp }) => {
              const mayHandOver = f.assigned_to === ctx.userId || opp.owner_id === ctx.userId || canAssign || founder;
              return (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 break-words"><span className="font-medium">{f.title}</span><span className="text-muted-foreground"> · {opp.reference} · {nameOf(f.assigned_to) ?? "Former colleague"} · </span><DueText dueAt={f.due_at} /></span>
                  {mayHandOver ? <ReassignFollowUpButton followUpId={f.id} assigneeId={f.assigned_to} people={people} title={f.title} /> : null}
                </li>
              );
            })}
            {view.accountFollowUps.map(({ followUp: f }) => {
              const mayHandOver = f.assigned_to === ctx.userId || f.created_by === ctx.userId || canAssign || founder;
              return (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 break-words"><span className="font-medium">{f.title}</span><span className="text-muted-foreground"> · Account follow-up · {nameOf(f.assigned_to) ?? "Former colleague"} · </span><DueText dueAt={f.due_at} /></span>
                  {mayHandOver ? <ReassignFollowUpButton followUpId={f.id} assigneeId={f.assigned_to} people={people} title={f.title} /> : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-sm text-muted-foreground">Follow-ups belong to an inquiry, or to the account itself when it has none. Each has its own person and due date; the account owner above is not changed by them.</p>
      </CardContent>
    </Card>
  );

  const outreachSection = (
    <OutreachSection
      items={outreach} orgId={org.id} orgName={org.name} companyId={company.id} today={todayInDubai()} canAssign={canAssign}
      nameOf={(uid) => nameOf(uid) ?? "Former colleague"} inquiries={view.inquiries.map((i) => ({ id: i.opp.id, label: `${i.opp.reference}: ${i.opp.title}` }))}
    />
  );

  return (
    <div className="space-y-6">
      {back}
      {sp.outreach_link === "failed" ? <Alert variant="warning" role="alert">The inquiry was created, but it could not be linked to the outreach. Use Link an inquiry in the Outreach section below.</Alert> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h1 className="break-words text-2xl font-semibold">{org.name}</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            {org.roles.length === 0 ? <OsBadge tone="quiet">Role not recorded</OsBadge> : org.roles.map((r) => <OsBadge key={r} tone={r === "agency" ? "blue" : r === "technology" ? "cyan" : "neutral"}>{ROLE_LABEL[r]}</OsBadge>)}
            <span className="text-sm text-muted-foreground">For {company.name}</span>
          </div>
        </div>
        <EditAccountButton orgId={org.id} companyId={company.id} values={formValues} />
      </div>

      <section aria-labelledby="acc-summary" className="space-y-2">
        <h2 id="acc-summary" className="sr-only">Summary</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {([
            ["Inquiries", String(c.inquiries), `${c.open} open · ${c.lost} lost`],
            ["Won inquiries", String(c.won), "confirmed as won"],
            ["Completed projects", c.completedProjects === null ? "Could not load" : String(c.completedProjects), c.projectsNotVisible > 0 ? `${c.projectsNotVisible} project(s) you cannot open not counted` : "projects you can open"],
            ["Direct", String(c.direct), "no agency recorded"],
            ["Through an agency", String(c.throughAgency), "this account is the end client"],
            ["As the agency", String(c.asAgency), "this account is the agency"],
          ] as const).map(([label, value, hint]) => (
            <div key={label} className="rounded-md border border-border p-3">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-xl font-semibold tabular-nums">{value}</dd>
              <dd className="text-xs text-muted-foreground">{hint}</dd>
            </div>
          ))}
        </dl>
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">How these are counted</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">{COUNT_DEFINITIONS.map((d) => <li key={d}>{d}</li>)}</ul>
        </details>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {([
                ["Country", org.country_code ? countryLabel(org.country_code) : null],
                ["Place", org.place],
                ["Website", org.website],
                ["VAT registration number / TRN", org.vat_trn],
                ["Trade licence number", org.trade_licence_no],
                ["Lead source", profile?.lead_source ? LEAD_SOURCE_LABEL[profile.lead_source] : null],
                ["Exhibition", profile?.exhibition ?? null],
                ["Relationship notes", org.note],
              ] as const).map(([label, value]) => (
                <div key={label} className="flex gap-2">
                  <dt className="w-32 flex-none text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 flex-1 break-words">{value ? (label === "Website" ? <a className="underline-offset-2 hover:underline" href={/^https?:\/\//i.test(value) ? value : `https://${value}`} target="_blank" rel="noreferrer noopener">{value}</a> : value) : <span className="text-muted-foreground">Not recorded</span>}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle>Account owner</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              {owner ? <span className="text-base font-medium">{owner}</span> : <OsBadge tone="amber">Unassigned</OsBadge>}
              <span className="text-muted-foreground">owner for {company.name}</span>
            </p>
            {canAssign ? <AssignOwnerButton orgId={org.id} companyId={company.id} ownerId={profile?.owner_id ?? null} people={people} /> : <p className="text-muted-foreground">Only a founder, or someone with the assign owners right, can change the account owner.</p>}
            <p className="text-muted-foreground">The account owner is separate from whoever is following up (see Follow-ups) and from the owner of each inquiry. Changing one does not change the others.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Contacts ({contacts.length})</CardTitle>
            <AddAccountContactButton orgId={org.id} orgName={org.name} />
          </div>
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? <p className="text-sm text-muted-foreground">No contacts recorded yet.</p> : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {contacts.map((ct) => (
                <li key={ct.id} className="min-w-0 rounded-md border border-border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="break-words font-medium">{ct.name}</p>{ct.role_title ? <p className="break-words text-muted-foreground">{ct.role_title}</p> : null}</div>
                    <EditAccountContactButton contact={ct} />
                  </div>
                  <p className="mt-1 break-all">{ct.email ? <a className="underline-offset-2 hover:underline" href={`mailto:${ct.email}`}>{ct.email}</a> : <span className="text-muted-foreground">Email not recorded</span>}</p>
                  <p>{ct.phone ?? <span className="text-muted-foreground">Phone not recorded</span>}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {!view.hasHistory ? (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle>History</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{NO_ACTIVITY}</p>
              <p className="text-muted-foreground">No inquiry, quote{view.accountFollowUps.length === 0 ? ", project or follow-up" : " or project"} is linked to this account for {company.name} yet. <Link className="underline underline-offset-2" href="/sales/opportunities?add=1">Record an enquiry</Link> to start its history.</p>
            </CardContent>
          </Card>
          {followUpsCard}
          {outreachSection}
        </>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle>Last recorded activity</CardTitle></CardHeader>
            <CardContent className="text-sm">
              {view.lastActivity ? <p>{ACTIVITY_LABEL[view.lastActivity.kind] ?? view.lastActivity.kind} on {formatDateTime(view.lastActivity.at)} · <Link className="underline-offset-2 hover:underline" href={`/sales/opportunities/${view.lastActivity.opp.id}`}>{view.lastActivity.opp.reference}: {view.lastActivity.opp.title}</Link></p> : <p>{NO_ACTIVITY}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle>Inquiries ({c.inquiries})</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {view.inquiries.map((i) => (
                  <li key={i.opp.id} className="grid gap-1 py-2 text-sm md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto_minmax(0,2fr)] md:items-center md:gap-3">
                    <Link className="min-w-0 break-words font-medium underline-offset-2 hover:underline" href={`/sales/opportunities/${i.opp.id}`}>{i.opp.reference}: {i.opp.title}</Link>
                    <span className="min-w-0 break-words text-muted-foreground">{routeText(i, orgNames)}</span>
                    <StageBadge stage={i.opp.stage} />
                    <span className="min-w-0 break-words text-muted-foreground">{i.opp.stage === "won" ? `Project: ${projectText(i.project)}` : ""}</span>
                  </li>
                ))}
              </ul>
              {c.projectsNotVisible > 0 ? <Alert className="mt-3">{c.projectsNotVisible} won {c.projectsNotVisible === 1 ? "inquiry has a project" : "inquiries have projects"} you cannot open, so {c.projectsNotVisible === 1 ? "its" : "their"} completion is not counted here.</Alert> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle>Quotes ({view.quotes.length}){c.inquiriesAwaitingReply ? ` · ${c.inquiriesAwaitingReply} awaiting reply` : ""}</CardTitle></CardHeader>
            <CardContent>
              {view.quotes.length === 0 ? <p className="text-sm text-muted-foreground">No quote or proposal recorded on this account&apos;s inquiries.</p> : (
                <ul className="divide-y divide-border">
                  {view.quotes.map((q) => {
                    const opp = view.inquiries.find((i) => i.opp.id === q.opportunityId)?.opp;
                    return (
                      <li key={q.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <span className="min-w-0 break-words">{q.label}{opp ? <span className="text-muted-foreground"> · {opp.reference}</span> : null}{q.sentOn ? <span className="text-muted-foreground"> · sent {formatDate(q.sentOn)}</span> : null}</span>
                        {q.awaitingReply ? <OsBadge tone="amber" dot>{q.display}</OsBadge> : <span className="text-muted-foreground">{q.display}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {followUpsCard}
          {outreachSection}
        </>
      )}
    </div>
  );
}
