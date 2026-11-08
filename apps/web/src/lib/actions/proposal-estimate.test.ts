import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
const rpc = vi.fn();
let estimateRow: { data: { proposal_id: string } | null; error: { message: string } | null } = { data: null, error: null };
const from = (t: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => (t === "crm_quotations" ? estimateRow : { data: null, error: null }) }) }) });
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));

import { setProposalStatus } from "./crm";

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
