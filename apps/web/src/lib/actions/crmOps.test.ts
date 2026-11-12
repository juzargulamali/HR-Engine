import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
const rpc = vi.fn();
// `current` is the version the (mocked) database holds for the enquiry; null = no such row, so the stale check stays silent.
let current: number | null = null;
const from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: current === null ? null : { version: current } }) }) }) });
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));

import { OPS_UNAVAILABLE } from "@/lib/crm/ops-planning";
import { answerOpsQuestion, removeOpsPlanning, setOpsPlanning } from "./crmOps";

// Fictional enquiry.
const O = "22222222-2222-4222-8222-222222222222";
const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const idle = { error: null };
const STALE = "This enquiry was changed by someone else. Reload the page to see the latest version, then make your change again.";

beforeEach(() => { current = null; revalidatePath.mockReset(); rpc.mockReset().mockResolvedValue({ data: 8, error: null }); });

describe("setOpsPlanning", () => {
  it("flags the enquiry and sends every planning field through crm_set_ops_planning, against the version the person saw", async () => {
    current = 7;
    const r = await setOpsPlanning(idle, fd({
      id: O, expectedVersion: "7", decisionDate: "2026-12-01", datesTentative: "on", dismantleDate: "2027-02-14", teams: ["warehouse", "engineering", "warehouse"],
      toConfirm: "  Stand size  ", note: "Night build only",
    }));
    expect(r).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("crm_set_ops_planning", {
      p_id: O, p_flag: true, p_expected_version: 7,
      p_fields: { decision_date: "2026-12-01", dates_tentative: true, dismantle_date: "2027-02-14", teams: ["warehouse", "engineering"], to_confirm: "Stand size", note: "Night build only" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/sales", "layout");
    expect(revalidatePath).toHaveBeenCalledWith(`/sales/opportunities/${O}`);
  });

  it("an emptied field is cleared (null), an unticked 'Dates are tentative' is false, and no answer is ever sent", async () => {
    await setOpsPlanning(idle, fd({ id: O, expectedVersion: "7", decisionDate: "", dismantleDate: "", toConfirm: "", note: "   " }));
    const args = rpc.mock.calls[0]![1] as { p_flag: boolean; p_fields: Record<string, unknown> };
    expect(args.p_flag).toBe(true);
    expect(args.p_fields).toEqual({ decision_date: null, dates_tentative: false, dismantle_date: null, teams: [], to_confirm: null, note: null });
    expect(args.p_fields).not.toHaveProperty("answer");
  });

  it("refuses what the database would refuse, in words, before anything is sent", async () => {
    const bad = async (o: Record<string, string | string[]>) => (await setOpsPlanning(idle, fd({ id: O, ...o }))).error;
    expect(await bad({ teams: ["finance"] })).toBe("Choose teams from the list");
    expect(await bad({ decisionDate: "next week" })).toBe("Use a valid date");
    expect(await bad({ note: "x".repeat(1001) })).toBe("The note for Operations can be at most 1000 characters");
    expect(await bad({ toConfirm: "x".repeat(1001) })).toBe("Still to confirm can be at most 1000 characters");
    expect((await setOpsPlanning(idle, fd({ id: "not-a-uuid" }))).error).not.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("says the enquiry moved on when the version is stale, and sends nothing", async () => {
    current = 9;
    expect((await setOpsPlanning(idle, fd({ id: O, expectedVersion: "7" }))).error).toBe(STALE);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the database's own refusals on as they are, and never shows raw permission wording", async () => {
    for (const [message, shown] of [
      ["A lost enquiry cannot be flagged for Operations planning", /lost enquiry cannot be flagged/],
      ["Only the owner of this opportunity or a founder can do this", /Only the owner/],
      ["permission denied for function crm_set_ops_planning", /^You are not allowed to do that\.$/],
    ] as const) {
      rpc.mockResolvedValueOnce({ data: null, error: { message } });
      expect((await setOpsPlanning(idle, fd({ id: O }))).error).toMatch(shown);
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("says Operations planning is not available when the database function is not installed, not that the form was wrong", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.crm_set_ops_planning in the schema cache" } });
    expect((await setOpsPlanning(idle, fd({ id: O }))).error).toBe(OPS_UNAVAILABLE);
    expect((await removeOpsPlanning(idle, fd({ id: O }))).error).toBe(OPS_UNAVAILABLE);
    expect((await answerOpsQuestion(idle, fd({ id: O, answer: "Yes" }))).error).toBe(OPS_UNAVAILABLE);
  });
});

describe("removeOpsPlanning", () => {
  it("unflags and sends no field, so the planning details stay on the enquiry", async () => {
    expect(await removeOpsPlanning(idle, fd({ id: O, expectedVersion: "7" }))).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith("crm_set_ops_planning", { p_id: O, p_flag: false, p_fields: {}, p_expected_version: 7 });
    expect(revalidatePath).toHaveBeenCalledWith(`/sales/opportunities/${O}`);
  });

  it("is refused in words on a stale version or a bad id", async () => {
    current = 9;
    expect((await removeOpsPlanning(idle, fd({ id: O, expectedVersion: "7" }))).error).toBe(STALE);
    expect((await removeOpsPlanning(idle, fd({ id: "" }))).error).not.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("answerOpsQuestion", () => {
  it("sends only the answer, leaves the flag as it is and changes no planning field", async () => {
    expect(await answerOpsQuestion(idle, fd({ id: O, expectedVersion: "7", answer: "  Yes, three points at 500 kg  " }))).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("crm_set_ops_planning", { p_id: O, p_flag: null, p_fields: { answer: "Yes, three points at 500 kg" }, p_expected_version: 7 });
    expect(revalidatePath).toHaveBeenCalledWith(`/sales/opportunities/${O}`);
  });

  it("needs an answer of at most 1000 characters", async () => {
    expect((await answerOpsQuestion(idle, fd({ id: O, answer: "   " }))).error).toBe("Write the answer for Operations");
    expect((await answerOpsQuestion(idle, fd({ id: O, answer: "x".repeat(1001) }))).error).toBe("The answer can be at most 1000 characters");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows a refusal from the database and refreshes nothing", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Only the owner of this opportunity or a founder can do this" } });
    expect((await answerOpsQuestion(idle, fd({ id: O, answer: "Yes" }))).error).toMatch(/Only the owner/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
