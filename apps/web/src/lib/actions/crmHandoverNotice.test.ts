import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import { dismissHandoverNotice } from "./crmHandoverNotice";

const ID = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { rpc.mockReset(); revalidatePath.mockReset(); });

describe("dismissHandoverNotice", () => {
  it("marks exactly that one notice read through the person's own mark-read function, and refreshes Sales and My Day", async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    expect(await dismissHandoverNotice(ID)).toEqual({ ok: true });
    expect(rpc.mock.calls).toEqual([["proj_mark_notifications_read", { p_ids: [ID] }]]);
    expect(revalidatePath.mock.calls).toEqual([["/sales", "layout"], ["/"]]);
  });
  it("never calls the database without one valid id (an empty list would mark every project notice read)", async () => {
    for (const bad of ["", "all", "null", "not-a-uuid"]) expect(await dismissHandoverNotice(bad)).toEqual({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("already dismissed elsewhere is not an error; a failed save is", async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    expect(await dismissHandoverNotice(ID)).toEqual({ ok: true });
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await dismissHandoverNotice(ID)).toEqual({ ok: false });
  });
});
