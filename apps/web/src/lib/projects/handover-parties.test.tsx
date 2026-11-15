/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));

import { HandoverBrief } from "@/components/projects/handover-brief";
import { HandoverPartiesFacts } from "@/app/(app)/projects/[id]/work/details-card";
import { handoverReadiness, type ReadinessBrief } from "@/app/(app)/sales/opportunities/[id]/handover/readiness";
import { agencyWords, noContactWords, NOT_RECORDED, parseParties, parseProjectHandover } from "./handover-parties";

// Fictional people and companies throughout.
const CONTACT = { contact_id: "c1", name: "Sara Site", role_title: "Site lead", phone: "+971 50 000 0001", email: "sara@example.test", taken_at: "2027-01-10T08:00:00Z" };
const projectAnswer = (over: Record<string, unknown> = {}) => ({ has_handover: true, handover_id: "h1", accepted_at: "2027-01-12T08:00:00Z", recorded: true, job_type: "agency", agency_name: "Fictional Agency", notes: "Loading bay B", contact_restricted: false, site_contact: CONTACT, ...over });
const facts = (raw: unknown) => { const details = parseProjectHandover(raw); return renderToStaticMarkup(<dl><HandoverPartiesFacts read={details ? { status: "ok", details } : { status: "error" }} /></dl>); };

describe("what the database answer means", () => {
  it("reads the agency, the job type and the contact; an answer that is not ours is a failed read, never 'not recorded'", () => {
    expect(parseParties({ recorded: true, job_type: "agency", agency_name: "Fictional Agency", site_contact: CONTACT })).toEqual({
      recorded: true, jobType: "agency", agencyName: "Fictional Agency", siteContact: { contactId: "c1", name: "Sara Site", roleTitle: "Site lead", phone: "+971 50 000 0001", email: "sara@example.test", takenAt: "2027-01-10T08:00:00Z" } });
    for (const bad of [null, undefined, [], "x", {}, { job_type: "agency" }]) expect(parseParties(bad)).toBeNull();
    expect(parseProjectHandover({ has_handover: false })).toMatchObject({ hasHandover: false, recorded: false, siteContact: null });
  });

  it("words a direct job, an agency and a brief from before the change differently", () => {
    expect(agencyWords({ recorded: true, jobType: "direct", agencyName: null })).toBe("None: a direct job");
    expect(agencyWords({ recorded: true, jobType: "agency", agencyName: "Fictional Agency" })).toBe("Fictional Agency");
    expect(agencyWords({ recorded: false, jobType: null, agencyName: null })).toBe(NOT_RECORDED);
    expect(noContactWords({ recorded: true })).toBe("None chosen at handover");
    expect(noContactWords({ recorded: false })).toBe(NOT_RECORDED);
    expect(noContactWords({ recorded: true }, true)).toMatch(/Shown to the Project Manager/);
  });
});

describe("the project's details card", () => {
  it("shows the agency, the contact with phone and e-mail links, and the notes to whoever manages the project", () => {
    const html = facts(projectAnswer());
    expect(html).toContain("Fictional Agency");
    expect(html).toContain("Sara Site");
    expect(html).toContain('href="tel:+971500000001"');
    expect(html).toContain('href="mailto:sara@example.test"');
    expect(html).toContain("Loading bay B");
    expect(html).toContain("From the handover, as accepted");
  });

  it("a team member gets the agency and the notes and is told who sees the contact; no contact detail is in the page", () => {
    const html = facts(projectAnswer({ contact_restricted: true, site_contact: null }));
    expect(html).toContain("Fictional Agency");
    expect(html).toContain("Shown to the Project Manager and Operations");
    expect(html).not.toMatch(/Sara|tel:|mailto:/);
  });

  it("a direct job and no contact chosen read as that", () => {
    const html = facts(projectAnswer({ job_type: "direct", agency_name: null, site_contact: null, notes: null }));
    expect(html).toContain("None: a direct job");
    expect(html).toContain("None chosen at handover");
  });

  it("a project accepted before the change says 'Not recorded at handover', never 'direct' and never empty", () => {
    const html = facts(projectAnswer({ recorded: false, job_type: null, agency_name: null, site_contact: null, notes: "Old notes" }));
    expect(html.split(NOT_RECORDED).length - 1).toBe(2);
    expect(html).not.toContain("direct job");
    expect(html).toContain("Old notes");
  });

  it("a failed read says so; a database without the functions and an internal project show nothing", () => {
    expect(facts("broken")).toMatch(/Could not load the agency, the site contact and the notes/);
    expect(renderToStaticMarkup(<dl><HandoverPartiesFacts read={{ status: "none" }} /></dl>)).toBe("<dl></dl>");
    expect(facts({ has_handover: false })).toBe("<dl></dl>");
  });
});

describe("the brief, as Sales and the Project Manager read it", () => {
  const h = { client_name: "Northwind Events", location: "Hall 4", site_timezone: "Asia/Dubai", install_start: null, event_start: null, event_end: null, technologies: [], scope: "LED wall", exclusions: null, risks: [], notes: null, crm_reference: "UAE-S-9" };
  it("shows the agency and the site contact when they are passed, a failed read as that, and nothing extra without them", () => {
    const withParties = renderToStaticMarkup(<HandoverBrief h={h} parties={parseParties({ recorded: true, job_type: "agency", agency_name: "Fictional Agency", site_contact: CONTACT })!} />);
    expect(withParties).toContain("Fictional Agency");
    expect(withParties).toContain("Sara Site");
    const failed = renderToStaticMarkup(<HandoverBrief h={h} parties="error" />);
    expect(failed).toContain("Could not load the site contact");
    const before = renderToStaticMarkup(<HandoverBrief h={h} />);
    expect(before).not.toMatch(/Agency|Site contact/);
  });
});

describe("Ready for handover, with the parties", () => {
  const brief: ReadinessBrief = { title: "Fictional stand", clientName: "", location: "Hall 4", siteTimezone: "Asia/Dubai", installStart: "2027-02-01", eventStart: "2027-02-03", eventEnd: "2027-02-05", scope: "LED wall", exclusions: "", notes: "Loading bay B", technologies: [{ name: "LED wall", qty: 1 }] };
  const run = (over: Partial<Parameters<typeof handoverReadiness>[0]> = {}) => handoverReadiness({ brief, saved: false, edition: null, contactCount: 2, formatDate: (d) => d, ...over });
  const value = (r: ReturnType<typeof run>, key: string) => r.transfers.find((t) => t.key === key);

  it("names the client the brief will take, the agency, the chosen contact and the notes", () => {
    const r = run({ parties: { clientName: "Northwind Events", agencyName: "Fictional Agency", siteContact: { name: "Sara Site", roleTitle: "Site lead" } } });
    expect(value(r, "client")).toMatchObject({ value: "Northwind Events (from the enquiry)", missing: false });
    expect(value(r, "agency")).toMatchObject({ value: "Fictional Agency" });
    expect(value(r, "contact")).toMatchObject({ value: "Sara Site, Site lead", missing: false });
    expect(value(r, "notes")).toMatchObject({ value: "Loading bay B" });
    expect(r.attention.find((a) => a.key === "contacts")!.text).toMatch(/^Only the site contact you choose is carried to the project/);
    expect(r.attention.some((a) => a.key === "notes")).toBe(false);
    expect(r.attention.some((a) => a.key === "contact")).toBe(false);
  });

  it("a direct job says so; with no end client the agency is the client name; no contact is a check, never a blocker", () => {
    const direct = run({ parties: { clientName: "Northwind Events", agencyName: null, siteContact: null } });
    expect(value(direct, "agency")).toMatchObject({ value: "None: a direct job" });
    expect(value(direct, "contact")).toMatchObject({ value: "None chosen", missing: true });
    expect(direct.ready).toBe(true);
    expect(direct.attention.find((a) => a.key === "contact")).toMatchObject({ kind: "check" });
    expect(value(run({ parties: { clientName: null, agencyName: "Fictional Agency", siteContact: null } }), "client")!.value).toBe("Fictional Agency (from the enquiry)");
    expect(run({ contactCount: 0, parties: { clientName: null, agencyName: null, siteContact: null } }).attention.find((a) => a.key === "contact")!.text).toMatch(/no contacts to choose from/);
    for (const a of direct.attention) expect(a.text).not.toContain("—");
  });

  it("without the parties (a database that does not record them) the lines are the earlier ones", () => {
    const r = run();
    expect(value(r, "agency")).toBeUndefined();
    expect(value(r, "client")!.value).toBe("The client or agency on the enquiry");
    expect(r.attention.find((a) => a.key === "contacts")!.text).toMatch(/^Contacts are not copied/);
  });
});
