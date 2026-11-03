import { describe, expect, it } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";
import { loadMyWaitingRequests, queueLabel, waitingAgeText, waitingText } from "./waiting";

const client = (tables: Record<string, FakeResult>) => fakeSupabase(tables) as unknown as Parameters<typeof loadMyWaitingRequests>[0];

describe("loadMyWaitingRequests", () => {
  it("counts each source and finds the oldest submission", async () => {
    const r = await loadMyWaitingRequests(
      client({
        leave_requests: rows([{ submitted_at: "2026-10-30T08:00:00Z" }, { submitted_at: "2026-10-28T08:00:00Z" }]),
        reimbursement_claims: rows([{ submitted_at: null, created_at: "2026-11-01T09:00:00Z" }]),
        recovery_credit_requests: rows([]),
      }),
      "e1",
    );
    expect(r.leave).toEqual({ status: "ok", count: 2, oldest: "2026-10-28T08:00:00Z" });
    expect(r.claims).toEqual({ status: "ok", count: 1, oldest: "2026-11-01T09:00:00Z" });
    expect(r.recovery).toEqual({ status: "ok", count: 0, oldest: null });
  });

  it("one failed source is its own error and the others still list (never a zero for the failed one)", async () => {
    const r = await loadMyWaitingRequests(client({ leave_requests: rows([{ submitted_at: "2026-10-30T08:00:00Z" }]), reimbursement_claims: failing(), recovery_credit_requests: rows([]) }), "e1");
    expect(r.claims).toEqual({ status: "error" });
    expect(r.leave).toMatchObject({ status: "ok", count: 1 });
    expect(r.recovery).toMatchObject({ status: "ok", count: 0 });
  });
});

describe("who the waiting requests are with", () => {
  const leave = (id: string) => ({ id, submitted_at: "2026-10-30T08:00:00Z" });
  it("names the person when the current step is routed to one", async () => {
    const r = await loadMyWaitingRequests(client({ leave_requests: rows([leave("l1")]), approvals: rows([{ entity_type: "leave_request", entity_id: "l1", approver_id: "u9", queue_roles: null }]), profiles: rows([{ id: "u9", full_name: "Pia Manager", email: "pia@x.test" }]) }), "e1");
    expect(r.leave).toMatchObject({ status: "ok", count: 1, with: "Pia Manager" });
  });
  it("names a shared queue as a queue, never one invented person", async () => {
    const r = await loadMyWaitingRequests(client({ recovery_credit_requests: rows([{ id: "r1", submitted_at: "2026-10-30T08:00:00Z" }]), approvals: rows([{ entity_type: "recovery_credit", entity_id: "r1", approver_id: null, queue_roles: ["hr_admin"] }]) }), "e1");
    expect(r.recovery).toMatchObject({ with: "the HR queue" });
    expect(queueLabel(["ceo", "cto"])).toBe("the CEO or CTO queue");
    expect(queueLabel(["finance"])).toBe("the Finance queue");
  });
  it("says how many different approvers when the requests are with several, and nothing when no step is readable", async () => {
    const two = await loadMyWaitingRequests(client({ leave_requests: rows([leave("l1"), leave("l2")]), approvals: rows([{ entity_type: "leave_request", entity_id: "l1", approver_id: "u9", queue_roles: null }, { entity_type: "leave_request", entity_id: "l2", approver_id: null, queue_roles: ["hr_admin"] }]), profiles: rows([{ id: "u9", full_name: "Pia Manager", email: null }]) }), "e1");
    expect(two.leave).toMatchObject({ with: "2 different approvers" });
    const none = await loadMyWaitingRequests(client({ leave_requests: rows([leave("l1")]), approvals: rows([]) }), "e1");
    expect(none.leave).toEqual({ status: "ok", count: 1, oldest: "2026-10-30T08:00:00Z" });
  });
  it("a request of another kind with the same id is not attributed (entity type must match)", async () => {
    const r = await loadMyWaitingRequests(client({ leave_requests: rows([leave("x1")]), approvals: rows([{ entity_type: "timesheet", entity_id: "x1", approver_id: "u9", queue_roles: null }]), profiles: rows([{ id: "u9", full_name: "Pia", email: null }]) }), "e1");
    expect(r.leave).not.toHaveProperty("with");
  });
  it("a failed read of who decides keeps the count and age and flags it; it is never silently blank", async () => {
    const r = await loadMyWaitingRequests(client({ leave_requests: rows([leave("l1")]), approvals: failing() }), "e1");
    expect(r.leave).toMatchObject({ status: "ok", count: 1, withFailed: true });
    const names = await loadMyWaitingRequests(client({ leave_requests: rows([leave("l1")]), approvals: rows([{ entity_type: "leave_request", entity_id: "l1", approver_id: "u9", queue_roles: null }]), profiles: failing() }), "e1");
    expect(names.leave).toMatchObject({ withFailed: true });
  });
});

describe("waitingAgeText", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  it("names how long a request has waited on the viewer", () => {
    expect(waitingAgeText("2026-11-02T01:00:00Z", now)).toBe("Waiting since today");
    expect(waitingAgeText("2026-10-31T11:00:00Z", now)).toBe("Waiting 2 days");
    expect(waitingAgeText(null, now)).toBeUndefined();
  });
});

describe("waitingText", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  it("names the waiting time in whole days", () => {
    expect(waitingText("2026-11-02T01:00:00Z", now)).toBe("Oldest submitted today");
    expect(waitingText("2026-11-01T01:00:00Z", now)).toBe("Oldest waiting 1 day");
    expect(waitingText("2026-10-28T12:00:00Z", now)).toBe("Oldest waiting 5 days");
    expect(waitingText(null, now)).toBeUndefined();
  });
});
