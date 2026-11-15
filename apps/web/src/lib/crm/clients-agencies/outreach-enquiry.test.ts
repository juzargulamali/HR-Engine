import { describe, expect, it } from "vitest";
import { ENQUIRY_BRIEF_MAX, ENQUIRY_TITLE_MAX, latestOutreachNote, outreachEnquiryBrief, outreachEnquiryHref, outreachEnquiryTitle } from "./outreach-enquiry";

const CO = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const OUT = "33333333-3333-4333-8333-333333333333";
const CONTACT = "44444444-4444-4444-8444-444444444444";
const ev = (kind: string, note: string | null, occurred_on: string, outcome: string | null = null) => ({ kind, note, occurred_on, outcome }) as never;

describe("outreach to enquiry: what is carried into the New enquiry form", () => {
  it("carries the company, the account, the outreach, a title, the one contact and a short brief", () => {
    const href = outreachEnquiryHref({
      companyId: CO, orgId: ORG, orgName: "Fictional Harbour Studio", outreachId: OUT, objective: "Introduce the LED tunnel", contactId: CONTACT,
      latestNote: { on: "2026-11-10", what: "Call, Spoke", note: "Asked for a quote & a site visit" },
    });
    expect(href.startsWith("/sales/new?")).toBe(true);
    const q = new URLSearchParams(href.split("?")[1]);
    expect(Object.fromEntries(q)).toEqual({
      company: CO, org: ORG, outreach: OUT, contact: CONTACT, source: "outreach",
      title: "Fictional Harbour Studio: Introduce the LED tunnel",
      brief: "Outreach objective: Introduce the LED tunnel Latest outreach note (2026-11-10, Call, Spoke): Asked for a quote & a site visit",
    });
    // the form opens with the Outreach source chosen (the person can still change it)
    expect(q.get("source")).toBe("outreach");
    // a database that does not know the Outreach source yet: no source is sent and the person chooses it, as before
    const older = new URLSearchParams(outreachEnquiryHref({ companyId: CO, orgId: ORG, orgName: "Fictional Co", outreachId: OUT, objective: null, withSource: false }).split("?")[1]);
    expect(older.has("source")).toBe(false);
  });
  it("sends nothing it does not know: no contact, no brief, and a plain title", () => {
    const q = new URLSearchParams(outreachEnquiryHref({ companyId: CO, orgId: ORG, orgName: "Fictional Co", outreachId: OUT, objective: null }).split("?")[1]);
    expect([...q.keys()].sort()).toEqual(["company", "org", "outreach", "source", "title"]);
    expect(q.get("title")).toBe("Fictional Co: enquiry from outreach");
  });
  it("keeps the title inside the form's limit and the brief short", () => {
    expect(outreachEnquiryTitle("Fictional Co", "x".repeat(400)).length).toBe(ENQUIRY_TITLE_MAX);
    const brief = outreachEnquiryBrief("y".repeat(500), { on: "2026-11-10", what: "Email, Sent", note: "z".repeat(900) });
    expect(brief.length).toBe(ENQUIRY_BRIEF_MAX);
    expect(brief.endsWith("…")).toBe(true);
    expect(outreachEnquiryBrief(null, null)).toBe("");
  });
  it("the latest note is the newest logged call, email or meeting that has one", () => {
    const events = [ev("assigned", "the objective", "2026-11-01"), ev("call", "Rang twice", "2026-11-03", "no_answer"), ev("email", null, "2026-11-04", "sent"), ev("next_action", "Send portfolio", "2026-11-05"), ev("status", "why", "2026-11-06")];
    expect(latestOutreachNote(events)).toEqual({ on: "2026-11-03", what: "Call, No answer", note: "Rang twice" });
    expect(latestOutreachNote([ev("assigned", "x", "2026-11-01")])).toBeNull();
    expect(latestOutreachNote([])).toBeNull();
  });
});
