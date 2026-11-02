import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { saveAndSubmitHandover, saveHandover } from "./projectsCore";

const O = "11111111-1111-4111-8111-111111111111";
const H = "22222222-2222-4222-8222-222222222222";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const brief = { opportunityId: O, expectedVersion: "", title: "Stand", scope: "Build it", risks: "Power\n\n  Access  \n" };

beforeEach(() => { rpc.mockReset().mockImplementation(async (fn: string) => (fn === "proj_save_handover" ? { data: H, error: null } : { data: null, error: null })); });

describe("save and submit in one step", () => {
  it("saves the brief (risks as a list) and then submits that handover", async () => {
    const r = await saveAndSubmitHandover({ error: null }, fd(brief));
    expect(r.error).toBeNull();
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["proj_save_handover", "proj_submit_handover"]);
    expect(rpc.mock.calls[0]![1].p_fields).toMatchObject({ title: "Stand", scope: "Build it", risks: ["Power", "Access"] });
    expect(rpc.mock.calls[1]![1]).toEqual({ p_handover_id: H });
  });
  it("Save draft (intent=draft) saves and never submits", async () => {
    const r = await saveAndSubmitHandover({ error: null }, fd({ ...brief, intent: "draft" }));
    expect(r.error).toBeNull();
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["proj_save_handover"]);
  });
  it("keeps the saved draft and says the submission was refused when the scope is missing", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === "proj_save_handover" ? { data: H, error: null } : { data: null, error: { message: "Describe the scope of work before submitting the handover" } }));
    const r = await saveAndSubmitHandover({ error: null }, fd({ ...brief, scope: "" }));
    expect(r.error).toMatch(/saved as a draft, but it was not submitted/);
    expect(r.error).toMatch(/scope/i);
  });
  it("does not submit when the save itself fails", async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { message: "Only the opportunity owner or a Sales founder can prepare its project handover" } }));
    const r = await saveAndSubmitHandover({ error: null }, fd(brief));
    expect(r.error).toBeTruthy();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("the plain save is unchanged: one call, no submission", async () => {
    await saveHandover({ error: null }, fd(brief));
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["proj_save_handover"]);
  });
});
