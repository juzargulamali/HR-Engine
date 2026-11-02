import { describe, expect, it } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";
import { loadMyWaitingRequests, waitingText } from "./waiting";

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

describe("waitingText", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  it("names the waiting time in whole days", () => {
    expect(waitingText("2026-11-02T01:00:00Z", now)).toBe("Oldest submitted today");
    expect(waitingText("2026-11-01T01:00:00Z", now)).toBe("Oldest waiting 1 day");
    expect(waitingText("2026-10-28T12:00:00Z", now)).toBe("Oldest waiting 5 days");
    expect(waitingText(null, now)).toBeUndefined();
  });
});
