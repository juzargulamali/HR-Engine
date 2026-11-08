import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
type Grant = { companyId: string; capabilities: string[] };
let grants: Grant[] = [];
let loadFailed = false;
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ({ userId: "44444444-4444-4444-8444-444444444444", fullName: "U", grants, loadFailed, companies: [], people: [], personName: () => "x", companyName: () => "x" }) }));

import { assignOutreach, linkOutreachInquiry, logOutreachActivity, setOutreachNextAction, setOutreachStatus } from "./outreach";

const CO = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const ORG2 = "33333333-3333-4333-8333-333333333334";
const SARA = "44444444-4444-4444-8444-444444444444";
const OUT = "77777777-7777-4777-8777-777777777777";
const OPP = "88888888-8888-4888-8888-888888888888";
const fd = (o: Record<string, string | string[]>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x); return f; };

beforeEach(() => { grants = []; loadFailed = false; rpc.mockReset().mockResolvedValue({ data: [], error: null }); });

describe("assigning outreach", () => {
  const form = (extra: Record<string, string | string[]> = {}) => fd({ companyId: CO, orgId: [ORG, ORG2], assigneeId: SARA, target: "2027-01-15", objective: "Reconnect", ...extra });
  it("is refused on the server, without a database call, without the assign owners right (also for another company's right)", async () => {
    grants = [{ companyId: CO, capabilities: [] }];
    expect((await assignOutreach({ error: null }, form())).error).toMatch(/Only a founder/);
    grants = [{ companyId: OTHER, capabilities: ["founder"] }];
    expect((await assignOutreach({ error: null }, form())).error).toMatch(/Only a founder/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("is one call for all selected accounts, returns each account's result, and calls no owner function", async () => {
    grants = [{ companyId: CO, capabilities: ["assign_owner"] }];
    rpc.mockResolvedValue({ data: [{ organisation_id: ORG, result: "assigned" }, { organisation_id: ORG2, result: "already" }], error: null });
    const r = await assignOutreach({ error: null }, form());
    expect(r.results).toEqual([{ organisation_id: ORG, result: "assigned" }, { organisation_id: ORG2, result: "already" }]);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["crm_assign_outreach"]);
    expect(rpc).toHaveBeenCalledWith("crm_assign_outreach", { p_company: CO, p_orgs: [ORG, ORG2], p_assignee: SARA, p_target: "2027-01-15", p_objective: "Reconnect" });
  });
  it("needs a target date, a person and at least one account; the objective is optional", async () => {
    grants = [{ companyId: CO, capabilities: ["founder"] }];
    expect((await assignOutreach({ error: null }, form({ target: "" }))).error).toMatch(/date/i);
    expect((await assignOutreach({ error: null }, form({ assigneeId: "" }))).error).toMatch(/who the outreach is for/);
    expect((await assignOutreach({ error: null }, fd({ companyId: CO, assigneeId: SARA, target: "2027-01-15" }))).error).toMatch(/at least one account/);
    expect(rpc).not.toHaveBeenCalled();
    await assignOutreach({ error: null }, form({ objective: "" }));
    expect(rpc).toHaveBeenCalledWith("crm_assign_outreach", expect.objectContaining({ p_objective: null }));
  });
  it("says it could not check access rather than 'no access' when the grants cannot be read", async () => {
    loadFailed = true;
    expect((await assignOutreach({ error: null }, form())).error).toMatch(/Could not check your Sales access/);
  });
  it("shows the database's refusal for an ineligible person in words", async () => {
    grants = [{ companyId: CO, capabilities: ["founder"] }];
    rpc.mockResolvedValue({ data: null, error: { message: "The chosen person has no Sales access for this company" } });
    expect((await assignOutreach({ error: null }, form())).error).toMatch(/no Sales access/);
  });
});

describe("logging, status, next action and linking", () => {
  it("logs with date, outcome and note; the outcome must be chosen from the list and is never defaulted to a reply", async () => {
    const base = { outreachId: OUT, kind: "email", on: "2026-11-06", note: "Sent portfolio" };
    expect((await logOutreachActivity({ error: null }, fd({ ...base, outcome: "" }))).error).toMatch(/Choose an outcome/);
    expect((await logOutreachActivity({ error: null }, fd({ ...base, outcome: "liked" }))).error).toMatch(/Choose an outcome/);
    expect(rpc).not.toHaveBeenCalled();
    expect(await logOutreachActivity({ error: null }, fd({ ...base, outcome: "sent" }))).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith("crm_outreach_log", { p_outreach: OUT, p_kind: "email", p_on: "2026-11-06", p_outcome: "sent", p_note: "Sent portfolio", p_next_action: null, p_next_due: null });
  });
  it("the outcome must fit the kind: Replied only for e-mail, Spoke only for a call; valid pairs are passed on, invalid ones never reach the database", async () => {
    const log = (kind: string, outcome: string) => logOutreachActivity({ error: null }, fd({ outreachId: OUT, kind, on: "2026-11-06", outcome }));
    for (const [kind, outcome] of [["call", "replied"], ["call", "sent"], ["email", "spoke"], ["email", "no_show"], ["meeting", "replied"], ["meeting", "no_answer"], ["call", "no_show"]] as [string, string][]) {
      expect((await log(kind, outcome)).error, `${kind}/${outcome}`).toMatch(/does not fit a/);
    }
    expect((await log("call", "replied")).error).toMatch(/Choose one of: No answer, Left message, Spoke, Call back requested, Not interested/);
    expect(rpc).not.toHaveBeenCalled();
    for (const [kind, outcome] of [["call", "call_back_requested"], ["call", "spoke"], ["email", "replied"], ["email", "bounced"], ["meeting", "meeting_booked"], ["meeting", "rescheduled"], ["meeting", "not_interested"]] as [string, string][]) {
      expect(await log(kind, outcome), `${kind}/${outcome}`).toEqual({ error: null });
    }
    expect(rpc).toHaveBeenCalledTimes(7);
  });
  it("a next action needs both its words and its date", async () => {
    const base = { outreachId: OUT, kind: "call", on: "2026-11-06", outcome: "spoke" };
    expect((await logOutreachActivity({ error: null }, fd({ ...base, nextAction: "Call back" }))).error).toMatch(/both/);
    expect((await setOutreachNextAction({ error: null }, fd({ outreachId: OUT, nextAction: "", nextDue: "2026-11-20" }))).error).toMatch(/what to do next/);
    expect(rpc).not.toHaveBeenCalled();
    await setOutreachNextAction({ error: null }, fd({ outreachId: OUT, nextAction: "Send quote", nextDue: "2026-11-20" }));
    expect(rpc).toHaveBeenCalledWith("crm_outreach_set_next", { p_outreach: OUT, p_text: "Send quote", p_due: "2026-11-20" });
  });
  it("Closed needs a reason, and Inquiry raised cannot be chosen by hand", async () => {
    expect((await setOutreachStatus({ error: null }, fd({ outreachId: OUT, status: "closed" }))).error).toMatch(/why it is closed/);
    expect((await setOutreachStatus({ error: null }, fd({ outreachId: OUT, status: "inquiry_raised" }))).error).toMatch(/Choose a status/);
    expect(rpc).not.toHaveBeenCalled();
    await setOutreachStatus({ error: null }, fd({ outreachId: OUT, status: "closed", reason: "Not interested" }));
    expect(rpc).toHaveBeenCalledWith("crm_outreach_set_status", { p_outreach: OUT, p_status: "closed", p_reason: "Not interested" });
    rpc.mockClear();
    await setOutreachStatus({ error: null }, fd({ outreachId: OUT, status: "meeting_booked" }));
    expect(rpc).toHaveBeenCalledWith("crm_outreach_set_status", { p_outreach: OUT, p_status: "meeting_booked", p_reason: null });
  });
  it("links an existing inquiry through the link function only, and shows the database's refusal", async () => {
    expect((await linkOutreachInquiry({ error: null }, fd({ outreachId: OUT, opportunityId: "" }))).error).toMatch(/Choose the inquiry/);
    expect(await linkOutreachInquiry({ error: null }, fd({ outreachId: OUT, opportunityId: OPP }))).toEqual({ error: null });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["crm_outreach_link_inquiry"]);
    rpc.mockResolvedValue({ data: null, error: { message: "Only the person this outreach is assigned to, or someone with the assign owners right, can change it" } });
    expect((await linkOutreachInquiry({ error: null }, fd({ outreachId: OUT, opportunityId: OPP }))).error).toMatch(/assigned to/);
  });
});
