import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, rpcs) }));

import { loadBudgetDay } from "./my-day-data";

const inbox = (over: Record<string, unknown>): FakeResult => ({ data: { companies: [], budget_approvals: [], final_expense_approvals: [], outstanding_settlement: [], ...over }, error: null });

beforeEach(() => { tables = {}; rpcs = {}; });

describe("loadBudgetDay", () => {
  it("an inbox that answers with nothing is a real zero", async () => {
    rpcs = { pbx_inbox: inbox({}) };
    expect(await loadBudgetDay("u1")).toMatchObject({ status: "ok", day: { waitingForMe: { count: 0 }, waitingOnOthers: 0 } });
  });
  it("a failed inbox read is an error, never zero", async () => {
    rpcs = { pbx_inbox: failing() };
    expect(await loadBudgetDay("u1")).toEqual({ status: "error" });
  });
  it("a reply without its lists is an error, never zero", async () => {
    rpcs = { pbx_inbox: { data: [], error: null } };
    expect(await loadBudgetDay("u1")).toEqual({ status: "error" });
  });
  it("module not installed here: nothing to show", async () => {
    rpcs = { pbx_inbox: { data: null, error: { message: "Could not find the function public.pbx_inbox", code: "PGRST202" } } };
    expect(await loadBudgetDay("u1")).toEqual({ status: "none" });
  });
  it("the person's own submissions are separated from the ones they can decide", async () => {
    rpcs = { pbx_inbox: inbox({ budget_approvals: [{ version_id: "mine", i_can_decide: false, on_hold: false }, { version_id: "theirs", i_can_decide: true, on_hold: false }] }) };
    tables = { pbx_budget_versions: rows([{ id: "mine" }]) };
    expect(await loadBudgetDay("u1")).toMatchObject({ status: "ok", day: { waitingForMe: { count: 1 }, waitingOnOthers: 1 } });
  });
  it("a failed read of who authored what is an error", async () => {
    rpcs = { pbx_inbox: inbox({ final_expense_approvals: [{ submission_id: "s1", i_can_decide: true, on_hold: false }] }) };
    tables = { pbx_actual_submissions: failing() };
    expect(await loadBudgetDay("u1")).toEqual({ status: "error" });
  });

  describe("the Project Manager's own projects", () => {
    const own = { proj_projects: rows([{ id: "p1" }]), proj_project_members: rows([]), pbx_budgets: rows([{ id: "b1", project_id: "p1" }]) };
    it("a PM with no budget access sees their project's returned budget, waiting items and recent decisions, from the budget records", async () => {
      rpcs = { pbx_inbox: inbox({}) };
      tables = {
        ...own,
        pbx_budget_versions: rows([{ id: "v1", budget_id: "b1", seq: 1, status: "returned", decided_at: new Date().toISOString() }]),
        pbx_actual_submissions: rows([{ id: "s1", budget_id: "b1", seq: 1, status: "submitted", decided_at: null }]),
      };
      expect(await loadBudgetDay("u1")).toMatchObject({ status: "ok", day: { returned: { count: 1, href: "/projects/p1/budget" }, waitingOnOthers: 1, waitingOnOthersHref: "/projects/p1/budget" } });
    });
    it("a failed read of the PM part keeps the inbox result and says so; it is never a zero", async () => {
      rpcs = { pbx_inbox: inbox({ budget_approvals: [{ version_id: "theirs", i_can_decide: true, on_hold: false }] }) };
      tables = { ...own, pbx_budgets: failing(), pbx_budget_versions: rows([]) };
      expect(await loadBudgetDay("u1")).toMatchObject({ status: "ok", day: { waitingForMe: { count: 1 }, pmReadFailed: true } });
      tables = { proj_projects: failing(), proj_project_members: rows([]) };
      expect(await loadBudgetDay("u1")).toMatchObject({ status: "ok", day: { pmReadFailed: true } });
    });
    it("a person who manages no project makes no budget reads for it and has no PM rows", async () => {
      rpcs = { pbx_inbox: inbox({}) };
      tables = { proj_projects: rows([]), proj_project_members: rows([]), pbx_budgets: failing() };
      expect(await loadBudgetDay("u1")).toMatchObject({ status: "ok", day: { returned: { count: 0 }, decidedRecently: { count: 0 }, waitingOnOthers: 0 } });
    });
  });
});
