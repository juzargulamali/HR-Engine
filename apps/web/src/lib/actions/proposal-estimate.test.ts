import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
const rpc = vi.fn();
let estimateRow: { data: { proposal_id: string } | null; error: { message: string } | null } = { data: null, error: null };
const from = (t: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => (t === "crm_quotations" ? estimateRow : { data: null, error: null }) }) }) });
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));

import { recordEstimateSent, setProposalStatus } from "./crm";

const P = "11111111-1111-4111-8111-111111111111";
const O = "22222222-2222-4222-8222-222222222222";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
beforeEach(() => { rpc.mockReset().mockResolvedValue({ data: null, error: null }); estimateRow = { data: null, error: null }; });

describe("recording a proposal version as sent (the existing Zoho / proposal workflow)", () => {
  it("still works for an ordinary proposal version (not an estimate)", async () => {
    expect(await setProposalStatus({ error: null }, fd({ proposalId: P, opportunityId: O, status: "sent", sentOn: "2026-11-01" }))).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith("crm_set_proposal_status", { p_proposal_id: P, p_status: "sent", p_sent_on: "2026-11-01" });
  });
  it("is refused for an ESTIMATE: it is never an official quotation sent, and it must not supersede the version really sent to the client", async () => {
    estimateRow = { data: { proposal_id: P }, error: null };
    const r = await setProposalStatus({ error: null }, fd({ proposalId: P, opportunityId: O, status: "sent", sentOn: "2026-11-01" }));
    expect(r.error).toMatch(/This version is an estimate/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("fails closed when the check itself cannot be made (never records on a guess)", async () => {
    estimateRow = { data: null, error: { message: "down" } };
    const r = await setProposalStatus({ error: null }, fd({ proposalId: P, opportunityId: O, status: "sent", sentOn: "2026-11-01" }));
    expect(r.error).toMatch(/Could not check/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("if the database itself refuses (it also guards estimates), its message is shown unchanged and nothing is refreshed", async () => {
    const message = "An estimate cannot be marked as sent. Send official quotations from the Zoho Books workflow.";
    rpc.mockResolvedValue({ data: null, error: { message, code: "EST01" } });
    const r = await setProposalStatus({ error: null }, fd({ proposalId: P, opportunityId: O, status: "sent", sentOn: "2026-11-01" }));
    expect(r.error).toBe(message);
  });
  it("withdrawing an estimate (Mark superseded) and the other statuses are unchanged", async () => {
    estimateRow = { data: { proposal_id: P }, error: null };
    expect(await setProposalStatus({ error: null }, fd({ proposalId: P, opportunityId: O, status: "superseded" }))).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith("crm_set_proposal_status", { p_proposal_id: P, p_status: "superseded", p_sent_on: null });
  });
});

describe("recording an ESTIMATE as sent (its own fact, on the Estimates tab)", () => {
  const form = { proposalId: P, opportunityId: O, sentOn: "2026-11-06", version: "7" };
  it("calls the one database function with the exact revision, the date, the version and whether to move; never the proposal status function", async () => {
    expect(await recordEstimateSent({ error: null }, fd({ ...form, move: "on" }))).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("crm_record_estimate_sent", { p_proposal: P, p_sent_on: "2026-11-06", p_move: true, p_expected_version: 7 });
    rpc.mockClear();
    expect(await recordEstimateSent({ error: null }, fd(form))).toEqual({ error: null });            // the box unticked: record only
    expect(rpc).toHaveBeenCalledWith("crm_record_estimate_sent", { p_proposal: P, p_sent_on: "2026-11-06", p_move: false, p_expected_version: 7 });
  });
  it("needs a real date and ids before the database is called", async () => {
    expect((await recordEstimateSent({ error: null }, fd({ ...form, sentOn: "" }))).error).toMatch(/date the estimate was sent/);
    expect((await recordEstimateSent({ error: null }, fd({ ...form, proposalId: "nope" }))).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shows the database's refusal in words, and says so when the database does not have the function yet", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Finalise the estimate before recording it as sent" } });
    expect((await recordEstimateSent({ error: null }, fd(form))).error).toBe("Finalise the estimate before recording it as sent");
    rpc.mockResolvedValue({ data: null, error: { message: "The enquiry is already past Estimate sent. Record the estimate without moving the stage" } });
    expect((await recordEstimateSent({ error: null }, fd({ ...form, move: "on" }))).error).toMatch(/already past Estimate sent/);
    rpc.mockResolvedValue({ data: null, error: { message: "Could not find the function public.crm_record_estimate_sent(p_move) in the schema cache" } });
    expect((await recordEstimateSent({ error: null }, fd(form))).error).toMatch(/not available yet.*Nothing was recorded/);
  });
  it("the proposal 'Record as sent' still refuses an estimate and points to the Estimates tab", async () => {
    estimateRow = { data: { proposal_id: P }, error: null };
    const r = await setProposalStatus({ error: null }, fd({ proposalId: P, opportunityId: O, status: "sent", sentOn: "2026-11-01" }));
    expect(r.error).toMatch(/Estimates tab use Record estimate as sent/);
    expect(rpc).not.toHaveBeenCalled();
  });
});
