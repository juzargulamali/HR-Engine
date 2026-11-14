import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const rpc = vi.fn();
let held: number | null = null;
const from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: held === null ? null : { version: held } }) }) }) });
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));

import { saveClientTimelineSelection } from "./projectsTimelineSelect";

const P = "11111111-1111-4111-8111-111111111111";
const M1 = "22222222-2222-4222-8222-222222222222";
const M2 = "33333333-3333-4333-8333-333333333333";
const I1 = "44444444-4444-4444-8444-444444444444";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };

beforeEach(() => { held = null; rpc.mockReset().mockResolvedValue({ data: null, error: null }); });

describe("choosing what the client sees", () => {
  it("writes only the items whose box changed, through the existing milestone and plan item functions, with the version they were shown at", async () => {
    const r = await saveClientTimelineSelection({ error: null }, fd({
      projectId: P,
      [`milewas_${M1}`]: "0", [`milever_${M1}`]: "3", [`mile_${M1}`]: "on",                 // newly ticked
      [`milewas_${M2}`]: "1", [`milever_${M2}`]: "2", [`mile_${M2}`]: "on",                 // unchanged
      [`itemwas_${I1}`]: "1", [`itemver_${I1}`]: "5",                                       // unticked
    }));
    expect(r.error ?? null).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("proj_save_milestone", { p_project_id: P, p_milestone_id: M1, p_fields: { client_facing: true, expected_version: 3 } });
    expect(rpc).toHaveBeenCalledWith("proj_save_plan_item", { p_project_id: P, p_item_id: I1, p_fields: { client_facing: false, expected_version: 5 } });
  });
  it("says so when nothing changed, and writes nothing", async () => {
    const r = await saveClientTimelineSelection({ error: null }, fd({ projectId: P, [`milewas_${M1}`]: "1", [`milever_${M1}`]: "1", [`mile_${M1}`]: "on" }));
    expect(r.error).toMatch(/Nothing changed/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("stops with the stale message when an item changed since it was shown, and reports what was already saved", async () => {
    held = 9;
    const r = await saveClientTimelineSelection({ error: null }, fd({ projectId: P, [`milewas_${M1}`]: "0", [`milever_${M1}`]: "3", [`mile_${M1}`]: "on" }));
    expect(r.error).toMatch(/Reload the page/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shows the database's own refusal in words", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "This project is completed." } });
    const r = await saveClientTimelineSelection({ error: null }, fd({ projectId: P, [`itemwas_${I1}`]: "0", [`itemver_${I1}`]: "1", [`item_${I1}`]: "on" }));
    expect(r.error).toMatch(/completed/);
  });
});
