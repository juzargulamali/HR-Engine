import Link from "next/link";
import { notFound } from "next/navigation";
import { canActOnAccountFollowUp, canActOnFollowUp, hasCrmCapability, isCrmActive, isCrmFounder } from "@enginious-hr/domain";
import { OsBadge } from "@/components/os/pills";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { BackLink } from "@/components/workspace/list-memory";
import { LoadError } from "@/components/workspace/states";
import { StageBadge, DueText } from "@/components/sales/badges";
import { ChooseCompanyNotice, CompanySwitch } from "@/components/sales/company-switch";
import { FollowUpRowActions } from "@/components/sales/follow-up-row-actions";
import { formatDate, formatDateTime } from "@/components/sales/format";
import { getCrmContext } from "@/lib/crm/context";
import { loadAccount, loadStaff, type AccountPage } from "@/lib/crm/clients-agencies/data";
import { loadAccountOutreach, type AccountOutreach } from "@/lib/crm/clients-agencies/outreach-data";
import { OutreachSection } from "../../outreach/outreach-section";
import { todayInDubai } from "@/components/sales/format";
import { COUNT_DEFINITIONS, type InquiryRow } from "@/lib/crm/clients-agencies/account";
import { pickSalesCompany } from "@/lib/crm/active-company-server";
import { countryLabel, LEAD_SOURCE_LABEL, ROLE_LABEL } from "@/lib/crm/clients-agencies/normalise";
import { eligibleStaff, type StaffPerson } from "@/lib/crm/clients-agencies/staff";
import { AddAccountContactButton, EditAccountButton, EditAccountContactButton } from "../account-forms";
import { AddAccountFollowUpButton, AddFollowUpButton, AssignOwnerButton, ReassignFollowUpButton } from "../owner-and-follow-ups";
import { PriorityControl } from "../priority-control";

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

export default async function AccountPageRoute({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ company?: string; outreach_link?: string; from?: string }> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // An account is shared by every company; what is shown beside it (owner, enquiries, follow-ups, outreach) belongs to ONE company. That company is the one in
  // the address (every link to an account carries it), else the one used last in Sales, else the person's own: never the first by name.
  const active = await pickSalesCompany(ctx, sp.company);
  const company = active.company;
  // Back returns to the directory as it was left (search, filters, sort, page), not to a bare list.
  // Opened from Follow-ups (its account links carry `from=follow-ups`): Back returns there, as that list was left.
  const back = sp.from === "follow-ups"
    ? <BackLink section="follow-ups" fallback="/sales/follow-ups">Follow-ups</BackLink>
    : <BackLink section="accounts" fallback={`/sales/accounts${company ? `?company=${company.id}` : ""}`}>Clients &amp; Agencies</BackLink>;
  // The switch also remembers the company on screen (it renders the memory), so the next Sales page opens in it.
  const companySwitch = <CompanySwitch companies={ctx.companies} current={company?.id ?? null} from={active.from} hrefFor={(c) => `/sales/accounts/${id}?company=${c}${sp.from === "follow-ups" ? "&from=follow-ups" : ""}`} />;
  if (!company) {
    return (
      <div className="space-y-4">
        {back}
        {active.from === "choose" ? <>{companySwitch}<ChooseCompanyNotice what="this account's owner, enquiries, follow-ups and outreach for that company" /></> : <LoadError what="this account" />}
      </div>
    );
  }

  let data: AccountPage | null;
  let staff: StaffPerson[];
  try {
    [data, staff] = await Promise.all([loadAccount(ctx, company.id, id), loadStaff()]);
  } catch (e) {
    console.error("[clients-agencies] account failed", e);
    return <div className="space-y-4">{back}{companySwitch}<LoadError what="this account" retryHref={`/sales/accounts/${id}?company=${company.id}`} /></div>;
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
  // The New enquiry page opens in this company with this account already chosen (its own existing behaviour for `company` + `org`).
  const newEnquiryHref = `/sales/new?company=${company.id}&org=${org.id}`;
  const enquiryHref = (oppId: string) => `/sales/opportunities/${oppId}`;

  // How many open follow-ups each enquiry has: completing the only one of an active enquiry must ask what happens next (the dialog and the database both hold that rule).
  const openPerOpp = new Map<string, number>();
  for (const { followUp: f } of view.followUps) if (f.opportunity_id) openPerOpp.set(f.opportunity_id, (openPerOpp.get(f.opportunity_id) ?? 0) + 1);
  // Soonest first across both kinds, so the first row is the account's next follow-up.
  const followUpRows = [
    ...view.followUps.map(({ followUp: f, opp, state }) => ({
      f, state, where: opp.reference as string, href: enquiryHref(opp.id) as string | null,
      // Complete, Reschedule and Cancel: the assignee, the enquiry's owner or a founder (crm_require_follow_up_actor, mirrored by canActOnFollowUp).
      canAct: canActOnFollowUp(ctx.grants, { assignedTo: f.assigned_to }, { companyId: opp.company_id, ownerId: opp.owner_id }, ctx.userId),
      // Reassign keeps its own, wider rule (it also admits the assign owners right), unchanged.
      mayHandOver: f.assigned_to === ctx.userId || opp.owner_id === ctx.userId || canAssign || founder,
      isOnlyOpen: isCrmActive(opp.stage) && (openPerOpp.get(opp.id) ?? 0) === 1,
    })),
    ...view.accountFollowUps.map(({ followUp: f, state }) => ({
      f, state, where: "Account follow-up", href: null as string | null,
      // The assignee, the person who added it or a founder (crm_require_account_follow_up_actor, mirrored by canActOnAccountFollowUp).
      canAct: canActOnAccountFollowUp(ctx.grants, { assignedTo: f.assigned_to, createdBy: f.created_by, companyId: f.company_id }, ctx.userId),
      mayHandOver: f.assigned_to === ctx.userId || f.created_by === ctx.userId || canAssign || founder,
      isOnlyOpen: false,
    })),
  ].sort((a, b) => a.f.due_at.localeCompare(b.f.due_at));
  const nextFollowUp = followUpRows[0] ?? null;

  const addFollowUp = openInquiries.length > 0
    ? <AddFollowUpButton inquiries={openInquiries.map((i) => ({ id: i.opp.id, label: `${i.opp.reference}: ${i.opp.title}` }))} people={people} defaultAssigneeId={ctx.userId} />
    : <AddAccountFollowUpButton orgId={org.id} companyId={company.id} people={people} currentUserId={ctx.userId} canAssign={canAssign} />;

  const contactsCard = (
    <Card id="contacts">
      <CardHeader className="pb-2"><CardTitle>Contacts ({contacts.length})</CardTitle></CardHeader>
      <CardContent>
        {contacts.length === 0 ? <p className="text-sm text-muted-foreground">No contacts recorded yet. Use Add contact at the top of the page.</p> : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {contacts.map((ct) => (
              <li key={ct.id} className="min-w-0 rounded-md border border-border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="break-words font-medium">{ct.name}</p>{ct.role_title ? <p className="break-words text-muted-foreground">{ct.role_title}</p> : null}</div>
                  <EditAccountContactButton contact={ct} />
                </div>
                <p className="mt-1 break-all">{ct.email ? <a className="underline-offset-2 hover:underline" href={`mailto:${ct.email}`}>{ct.email}</a> : <span className="text-muted-foreground">Email not recorded</span>}</p>
                <p>{ct.phone ? <a className="tabular-nums underline-offset-2 hover:underline" href={`tel:${ct.phone.replace(/[^+\d]/g, "")}`}>{ct.phone}</a> : <span className="text-muted-foreground">Phone not recorded</span>}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );

  const openEnquiriesCard = (
    <Card id="open-enquiries">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Open enquiries ({openInquiries.length})</CardTitle>
          <Link href={newEnquiryHref} className={buttonVariants({ variant: "outline", size: "sm" })} data-testid="account-new-enquiry">New enquiry for this account</Link>
        </div>
      </CardHeader>
      <CardContent>
        {openInquiries.length === 0 ? <p className="text-sm text-muted-foreground">No open enquiry for {company.name}.{c.inquiries > 0 ? " Won and lost ones are under History below." : ""}</p> : (
          <ul className="divide-y divide-border">
            {openInquiries.map((i) => (
              <li key={i.opp.id} className="grid gap-1 py-2 text-sm md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)_auto] md:items-center md:gap-3">
                <Link className="min-w-0 break-words font-medium underline-offset-2 hover:underline" href={enquiryHref(i.opp.id)}>{i.opp.reference}: {i.opp.title}</Link>
                <span className="min-w-0 break-words text-muted-foreground">{routeText(i, orgNames)}</span>
                <StageBadge stage={i.opp.stage} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );

  const followUpsCard = (
    <Card id="follow-ups">
      <CardHeader className="pb-2">
        <CardTitle>
          Follow-ups ({c.openFollowUps} open{c.overdueFollowUps ? `, ${c.overdueFollowUps} overdue` : ""})
          <InfoHint label="Follow-ups" className="ml-1">
            Follow-ups belong to an enquiry, or to the account itself when it has none. Each has its own person and due date; the account owner is not changed by them. Completing, rescheduling or reassigning one only records it here: nothing is sent to the client.
          </InfoHint>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {followUpRows.length === 0 ? <p className="text-sm text-muted-foreground">No open follow-ups. Use Add follow-up at the top of the page to plan the next step.</p> : (
          <ul className="divide-y divide-border">
            {followUpRows.map((r, n) => (
              <li key={r.f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid="account-follow-up" data-state={r.state}>
                <span className="min-w-0 break-words">
                  {n === 0 ? <OsBadge tone={r.state === "overdue" ? "red" : r.state === "today" ? "amber" : "neutral"} className="mr-1.5 whitespace-nowrap">Next</OsBadge> : null}
                  <span className="font-medium">{r.f.title}</span>
                  <span className="text-muted-foreground"> · {r.href ? <Link href={r.href} className="underline-offset-2 hover:underline">{r.where}</Link> : r.where} · {nameOf(r.f.assigned_to) ?? "Former colleague"} · </span>
                  <DueText dueAt={r.f.due_at} />
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {r.canAct ? <FollowUpRowActions followUp={{ id: r.f.id, title: r.f.title, opportunityId: r.f.opportunity_id, isOnlyOpen: r.isOnlyOpen }} /> : null}
                  {r.mayHandOver ? <ReassignFollowUpButton followUpId={r.f.id} assigneeId={r.f.assigned_to} people={people} title={r.f.title} /> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );

  const outreachSection = (
    <OutreachSection
      items={outreach} orgId={org.id} orgName={org.name} companyId={company.id} today={todayInDubai()} canAssign={canAssign}
      nameOf={(uid) => nameOf(uid) ?? "Former colleague"} inquiries={view.inquiries.map((i) => ({ id: i.opp.id, label: `${i.opp.reference}: ${i.opp.title}` }))}
      // The contact chosen on the outreach is carried into a new enquiry; when none was chosen, the account's one recorded contact is (it is then certain who it is from).
      onlyContactId={contacts.length === 1 ? contacts[0]!.id : null}
      contacts={contacts.map((ct) => ({ id: ct.id, name: ct.name, roleTitle: ct.role_title ?? null }))}
    />
  );

  return (
    <div className="space-y-5">
      {back}
      {sp.outreach_link === "failed" ? <Alert variant="warning" role="alert">The enquiry was created, but it could not be linked to the outreach. Use <a href="#outreach" className="font-medium underline underline-offset-2">Link an enquiry in the Outreach section</a> to link it.</Alert> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h1 className="break-words text-2xl font-semibold">{org.name}</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            {org.roles.length === 0 ? <OsBadge tone="quiet">Role not recorded</OsBadge> : org.roles.map((r) => <OsBadge key={r} tone={r === "agency" ? "blue" : r === "technology" ? "cyan" : "neutral"}>{ROLE_LABEL[r]}</OsBadge>)}
            <span className="text-sm text-muted-foreground">Owner: {owner ? <span className="font-medium text-foreground">{owner}</span> : <span className="font-medium text-[hsl(var(--os-amber))]">Unassigned</span>}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {addFollowUp}
          <AddAccountContactButton orgId={org.id} orgName={org.name} />
          <EditAccountButton orgId={org.id} companyId={company.id} values={formValues} />
        </div>
      </div>
      {companySwitch}

      {/* What needs attention first, in one line: the next follow-up, or that nothing is planned. */}
      <p className="os-card flex flex-wrap items-center gap-x-2 gap-y-1 p-3 text-sm" role="status" data-testid="account-next">
        {nextFollowUp ? (
          <>
            <span className="text-muted-foreground">Next follow-up:</span>
            <span className="min-w-0 break-words font-medium">{nextFollowUp.f.title}</span>
            <DueText dueAt={nextFollowUp.f.due_at} />
            <span className="text-muted-foreground">· {nameOf(nextFollowUp.f.assigned_to) ?? "Former colleague"}</span>
            <a href="#follow-ups" className="underline underline-offset-2">Open follow-ups</a>
          </>
        ) : openInquiries.length > 0 ? (
          <span className="font-medium text-[hsl(var(--os-amber))]">No follow-up is planned, and {openInquiries.length === 1 ? "an enquiry is" : `${openInquiries.length} enquiries are`} open. Add a follow-up.</span>
        ) : (
          <span className="text-muted-foreground">No follow-up is planned for {company.name}.</span>
        )}
      </p>

      {contactsCard}
      {openEnquiriesCard}
      {followUpsCard}
      {outreachSection}

      <section aria-labelledby="acc-summary" className="space-y-2">
        <h2 id="acc-summary" className="text-lg font-semibold">
          Figures for {company.name}
          <InfoHint label="How these are counted" className="ml-1"><ul className="list-disc space-y-1 pl-4">{COUNT_DEFINITIONS.map((d) => <li key={d}>{d}</li>)}</ul></InfoHint>
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {([
            ["Enquiries", String(c.inquiries), `${c.open} open · ${c.lost} lost`],
            ["Won enquiries", String(c.won), "confirmed as won"],
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

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>
                Outreach priority
                <InfoHint label="Outreach priority" className="ml-1">One rating for the whole team, 1 to 5 (5 is highest) or Unrated. It says who to approach first; it is not a review score. Every Enginious company sees the same value.</InfoHint>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <PriorityControl orgId={org.id} value={org.outreach_priority} label="Outreach priority (shared)" />
              {org.outreach_priority_at ? <p className="text-muted-foreground">Last set {formatDate(org.outreach_priority_at)}.</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>
                Account owner
                <InfoHint label="Account owner" className="ml-1">The account owner is separate from whoever is following up (see Follow-ups) and from the owner of each enquiry. Changing one does not change the others.</InfoHint>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                {owner ? <span className="text-base font-medium">{owner}</span> : <OsBadge tone="amber">Unassigned</OsBadge>}
                <span className="text-muted-foreground">owner for {company.name}</span>
              </p>
              {canAssign ? <AssignOwnerButton orgId={org.id} companyId={company.id} ownerId={profile?.owner_id ?? null} people={people} /> : <p className="text-muted-foreground">Only a founder, or someone with the assign owners right, can change the account owner.</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      <h2 className="text-lg font-semibold">History</h2>
      {!view.hasHistory ? (
        <Card>
          <CardContent className="space-y-2 pt-4 text-sm">
            <p>{NO_ACTIVITY}</p>
            <p className="text-muted-foreground">No enquiry, quote{view.accountFollowUps.length === 0 ? ", project or follow-up" : " or project"} is linked to this account for {company.name} yet. <Link className="underline underline-offset-2" href={newEnquiryHref}>Record an enquiry</Link> to start its history.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle>Last recorded activity</CardTitle></CardHeader>
            <CardContent className="text-sm">
              {view.lastActivity ? <p>{ACTIVITY_LABEL[view.lastActivity.kind] ?? view.lastActivity.kind} on {formatDateTime(view.lastActivity.at)} · <Link className="underline-offset-2 hover:underline" href={enquiryHref(view.lastActivity.opp.id)}>{view.lastActivity.opp.reference}: {view.lastActivity.opp.title}</Link></p> : <p>{NO_ACTIVITY}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle>Enquiries ({c.inquiries})</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {view.inquiries.map((i) => (
                  <li key={i.opp.id} className="grid gap-1 py-2 text-sm md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto_minmax(0,2fr)] md:items-center md:gap-3">
                    <Link className="min-w-0 break-words font-medium underline-offset-2 hover:underline" href={enquiryHref(i.opp.id)}>{i.opp.reference}: {i.opp.title}</Link>
                    <span className="min-w-0 break-words text-muted-foreground">{routeText(i, orgNames)}</span>
                    <StageBadge stage={i.opp.stage} />
                    <span className="min-w-0 break-words text-muted-foreground">{i.opp.stage === "won" ? `Project: ${projectText(i.project)}` : ""}</span>
                  </li>
                ))}
              </ul>
              {c.projectsNotVisible > 0 ? <Alert className="mt-3">{c.projectsNotVisible} won {c.projectsNotVisible === 1 ? "enquiry has a project" : "enquiries have projects"} you cannot open, so {c.projectsNotVisible === 1 ? "its" : "their"} completion is not counted here.</Alert> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle>Quotes ({view.quotes.length}){c.inquiriesAwaitingReply ? ` · ${c.inquiriesAwaitingReply} awaiting reply` : ""}</CardTitle></CardHeader>
            <CardContent>
              {view.quotes.length === 0 ? <p className="text-sm text-muted-foreground">No quote or proposal recorded on this account&apos;s enquiries.</p> : (
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
        </>
      )}
    </div>
  );
}
